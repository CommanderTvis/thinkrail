import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDiscordRuntime } from "./lifecycle";

const APPLICATION_ID = "1234567890123456789";

function frame(op: number, payload: unknown): Buffer {
	const body = Buffer.from(JSON.stringify(payload), "utf8");
	const header = Buffer.alloc(8);
	header.writeUInt32LE(op, 0);
	header.writeUInt32LE(body.length, 4);
	return Buffer.concat([header, body]);
}

function startFakeDiscord(socketPath: string): Server {
	const server = createServer((socket) => {
		socket.on("data", (chunk: Buffer) => {
			if (chunk.readUInt32LE(0) === 0) socket.write(frame(0, { evt: "READY" }));
		});
	});
	server.listen(socketPath);
	return server;
}

let tmpDirWithNoSocket: string;
const savedIpcDir = process.env.THINKRAIL_DISCORD_IPC_DIR;

beforeEach(() => {
	tmpDirWithNoSocket = mkdtempSync(join(tmpdir(), "trpi-discord-empty-"));
	process.env.THINKRAIL_DISCORD_IPC_DIR = tmpDirWithNoSocket;
});

afterEach(() => {
	rmSync(tmpDirWithNoSocket, { recursive: true, force: true });
	if (savedIpcDir === undefined) delete process.env.THINKRAIL_DISCORD_IPC_DIR;
	else process.env.THINKRAIL_DISCORD_IPC_DIR = savedIpcDir;
});

test("Discord starting after a failed attempt is not noticed until the retry floor clears, but a settings change clears it immediately", async () => {
	const runtime = createDiscordRuntime(
		() => ({ applicationId: APPLICATION_ID, blockedProjectIds: [], shareFileName: true }),
		() => {},
	);
	runtime.applySettingsChange();
	expect((await runtime.getStatus()).state).toBe("unavailable");

	const socketDir = mkdtempSync(join(tmpdir(), "trpi-discord-fake-"));
	const server = startFakeDiscord(join(socketDir, "discord-ipc-0"));
	try {
		process.env.THINKRAIL_DISCORD_IPC_DIR = socketDir;

		// Still within the retry floor from the first failure: the socket now exists, but nothing
		// re-checks disk until either the floor elapses or the settings change resets it.
		expect((await runtime.getStatus()).state).toBe("unavailable");

		runtime.applySettingsChange();
		// applySettingsChange starts the reconnect but does not wait for it; poll for the handshake
		// the same way the client's settings-pane polling would.
		let state = (await runtime.getStatus()).state;
		for (let attempt = 0; state === "connecting" && attempt < 20; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 20));
			state = (await runtime.getStatus()).state;
		}
		expect(state).toBe("connected");
	} finally {
		server.close();
		rmSync(socketDir, { recursive: true, force: true });
		runtime.stop();
	}
});
