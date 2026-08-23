import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applySelectionChanged,
	setIdeBridgeDeps,
	startIdeBridge,
	stopIdeBridge,
} from "./ideBridge";
import { IDE_AUTH_HEADER } from "./mcp";

let home: string | null = null;
const configDir = process.env.CLAUDE_CONFIG_DIR;

afterEach(async () => {
	await stopIdeBridge();
	setIdeBridgeDeps(null);
	if (home) rmSync(home, { recursive: true, force: true });
	home = null;
	if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = configDir;
});

interface Cli {
	socket: WebSocket;
	messages: string[];
}

// Bun's WebSocket takes request headers, which is how a CLI presents the token; the DOM type in scope does not.
const AuthedWebSocket = WebSocket as unknown as new (
	url: string,
	options: { headers: Record<string, string> },
) => WebSocket;

async function connectCli(port: number, token: string): Promise<Cli> {
	const socket = new AuthedWebSocket(`ws://127.0.0.1:${port}`, {
		headers: { [IDE_AUTH_HEADER]: token },
	});
	const cli: Cli = { socket, messages: [] };
	socket.addEventListener("message", (event) => cli.messages.push(String(event.data)));
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve());
		socket.addEventListener("error", () => reject(new Error("the bridge refused the socket")));
	});
	return cli;
}

async function startBridge(): Promise<{ port: number; token: string }> {
	home = mkdtempSync(join(tmpdir(), "thinkrail-ide-"));
	process.env.CLAUDE_CONFIG_DIR = home;
	setIdeBridgeDeps({ dispatch: () => {}, listWorkspaceFolders: () => ["/repo"] });
	const started = await startIdeBridge();
	if (!started) throw new Error("the bridge did not start");
	const lock = JSON.parse(readFileSync(join(home, "ide", `${started.port}.lock`), "utf8")) as {
		authToken: string;
	};
	return { port: started.port, token: lock.authToken };
}

async function settle(): Promise<void> {
	await Bun.sleep(50);
}

test("two CLIs hold the bridge at once and both hear the editor", async () => {
	const { port, token } = await startBridge();
	const first = await connectCli(port, token);
	const second = await connectCli(port, token);
	await settle();

	applySelectionChanged({
		workspaceId: "ws-1",
		path: "/repo/a.ts",
		text: "chunk",
		selection: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 4 },
	});
	await settle();

	expect(first.messages.join()).toContain("selection_changed");
	expect(second.messages.join()).toContain("selection_changed");
	expect(first.socket.readyState).toBe(WebSocket.OPEN);
});

test("a CLI that goes away is forgotten, and the rest keep the bridge", async () => {
	const { port, token } = await startBridge();
	const first = await connectCli(port, token);
	const second = await connectCli(port, token);
	first.socket.close();
	await settle();

	applySelectionChanged({
		workspaceId: "ws-1",
		path: "/repo/b.ts",
		text: "chunk",
		selection: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 4 },
	});
	await settle();

	expect(first.messages).toHaveLength(0);
	expect(second.messages.join()).toContain("/repo/b.ts");
});

test("a socket without the lock file's token never reaches the bridge", async () => {
	const { port } = await startBridge();
	await expect(connectCli(port, "not-the-token")).rejects.toThrow();
});
