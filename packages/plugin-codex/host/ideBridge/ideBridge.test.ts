import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIdeBridge } from "./index";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const stop of cleanup.splice(0).reverse()) stop();
});

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "tr-ide-"));
	cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
	return {
		dir,
		path:
			process.platform === "win32" ? `\\\\.\\pipe\\tr-ide-${randomUUID()}` : join(dir, "ipc.sock"),
	};
}

function provider(path: string, root: string) {
	const warnings: unknown[] = [];
	const stop = startIdeBridge({
		path,
		canHandle: (requested) => requested === root,
		context: async () => ({
			activeFile: null,
			openTabs: [{ path: `${root}/file.ts`, label: "file.ts" }],
		}),
		warn: (error) => warnings.push(error),
	});
	cleanup.push(stop);
	return { stop, warnings };
}

async function client(path: string) {
	const socket = connect(path);
	cleanup.push(() => socket.destroy());
	await new Promise<void>((resolve, reject) => {
		socket.once("connect", resolve);
		socket.once("error", reject);
	});
	return socket;
}

function frame(value: unknown) {
	const data = Buffer.from(JSON.stringify(value));
	const length = Buffer.alloc(4);
	length.writeUInt32LE(data.length);
	return Buffer.concat([length, data]);
}

function response(socket: Socket): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		let data = Buffer.alloc(0);
		const timer = setTimeout(() => reject(new Error("No IPC response")), 4500);
		const receive = (chunk: Buffer) => {
			data = Buffer.concat([data, chunk]);
			if (data.length < 4 || data.length < 4 + data.readUInt32LE()) return;
			clearTimeout(timer);
			socket.off("data", receive);
			resolve(JSON.parse(data.subarray(4, 4 + data.readUInt32LE()).toString()));
		};
		socket.on("data", receive);
	});
}

async function request(path: string, root: string) {
	const socket = await client(path);
	const reply = response(socket);
	const bytes = frame({
		type: "request",
		requestId: "tui-request",
		sourceClientId: "codex-tui",
		version: 0,
		method: "ide-context",
		params: { workspaceRoot: root },
	});
	socket.write(bytes.subarray(0, 2));
	socket.write(bytes.subarray(2, 9));
	socket.write(bytes.subarray(9));
	try {
		return await reply;
	} finally {
		socket.destroy();
	}
}

async function until(check: () => boolean | Promise<boolean>) {
	const deadline = Date.now() + 6000;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("Condition timed out");
}

async function ready(path: string, root: string) {
	await until(async () => {
		try {
			return (await request(path, root)).resultType === "success";
		} catch {
			return false;
		}
	});
}

test("native TUI frames route to the matching provider and survive router owner shutdown", async () => {
	const { path } = fixture();
	const first = provider(path, "/one");
	await ready(path, "/one");
	const second = provider(path, "/two");
	await ready(path, "/two");
	const concurrent = await Promise.all([request(path, "/one"), request(path, "/two")]);
	expect(concurrent.map((reply) => reply.result)).toEqual([
		{ ideContext: { activeFile: null, openTabs: [{ path: "/one/file.ts", label: "file.ts" }] } },
		{ ideContext: { activeFile: null, openTabs: [{ path: "/two/file.ts", label: "file.ts" }] } },
	]);
	expect(await request(path, "/one")).toMatchObject({
		requestId: "tui-request",
		resultType: "success",
		result: { ideContext: { openTabs: [{ path: "/one/file.ts", label: "file.ts" }] } },
	});
	expect(await request(path, "/unknown")).toMatchObject({
		resultType: "error",
		error: "no-client-found",
	});
	if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
	first.stop();
	await ready(path, "/two");
	expect(first.warnings).toEqual([]);
	expect(second.warnings).toEqual([]);
	second.stop();
	await until(() => !existsSync(path));
}, 15000);

test("a provider disconnect does not remove another router's socket", async () => {
	const { path } = fixture();
	provider(path, "/one");
	await ready(path, "/one");
	const second = provider(path, "/two");
	await ready(path, "/two");
	second.stop();
	await ready(path, "/one");
	expect(await request(path, "/two")).toMatchObject({ resultType: "error" });
});

test.skipIf(process.platform === "win32")(
	"unsafe directories and non-socket files are preserved",
	async () => {
		const { dir, path } = fixture();
		writeFileSync(path, "keep this file");
		const first = provider(path, "/one");
		expect(first.warnings).toHaveLength(1);
		expect(readFileSync(path, "utf8")).toBe("keep this file");
		first.stop();
		chmodSync(dir, 0o777);
		const second = provider(path, "/two");
		expect(second.warnings).toHaveLength(1);
		expect(String(second.warnings[0])).toContain("not writable by others");
	},
);

test("oversized and malformed frames close only the offending connection", async () => {
	const { path } = fixture();
	provider(path, "/one");
	await ready(path, "/one");
	for (const data of [Buffer.from([0, 0, 0, 127]), frame({ type: "request", requestId: 42 })]) {
		const socket = await client(path);
		const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
		socket.write(data);
		await closed;
	}
	await ready(path, "/one");
});

test("disposal during connection startup does not create a listener afterwards", async () => {
	const { path } = fixture();
	provider(path, "/one").stop();
	await new Promise((resolve) => setTimeout(resolve, 1100));
	expect(existsSync(path)).toBe(false);
});

test("an existing router can discover the provider and gets explicit version errors", async () => {
	const { path } = fixture();
	const { createServer } = await import("node:net");
	const server = createServer();
	cleanup.push(() => server.close());
	await new Promise<void>((resolve) => server.listen(path, resolve));
	const incoming = new Promise<Socket>((resolve) => server.once("connection", resolve));
	const bridge = provider(path, "/one");
	const socket = await incoming;
	cleanup.push(() => socket.destroy());
	const initialize = await response(socket);
	expect(initialize).toMatchObject({ method: "initialize", params: { clientType: "vscode" } });
	socket.write(
		frame({
			type: "response",
			requestId: initialize.requestId,
			resultType: "success",
			method: "initialize",
			result: { clientId: "editor" },
		}),
	);
	const discovery = response(socket);
	socket.write(
		frame({
			type: "client-discovery-request",
			requestId: "discovery",
			request: { method: "ide-context", version: 0, params: { workspaceRoot: "/one" } },
		}),
	);
	expect(await discovery).toMatchObject({
		type: "client-discovery-response",
		response: { canHandle: true },
	});
	const rejected = response(socket);
	socket.write(
		frame({
			type: "request",
			requestId: "future",
			method: "ide-context",
			version: 1,
			params: { workspaceRoot: "/one" },
		}),
	);
	expect(await rejected).toMatchObject({ resultType: "error", error: "request-version-mismatch" });
	bridge.stop();
	expect(server.listening).toBe(true);
});

test.skipIf(process.platform === "win32")(
	"a crashed router's stale socket is recovered",
	async () => {
		const { path } = fixture();
		const child = Bun.spawn(
			[
				process.execPath,
				"-e",
				"require('node:net').createServer().listen(process.argv[1], () => console.log('ready'))",
				path,
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		cleanup.push(() => child.kill());
		const reader = child.stdout.getReader();
		await reader.read();
		reader.releaseLock();
		child.kill("SIGKILL");
		await child.exited;
		expect(existsSync(path)).toBe(true);
		const bridge = provider(path, "/one");
		await ready(path, "/one");
		expect(bridge.warnings).toEqual([]);
	},
);
