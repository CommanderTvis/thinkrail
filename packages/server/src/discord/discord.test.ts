import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateConfig } from "../settings";
import { applyDiscordSettings, getDiscordStatus, resetDiscordForTests } from "./discord";

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

let dataDir: string;
let tmpDirWithNoSocket: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const savedIpcDir = process.env.THINKRAIL_DISCORD_IPC_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-discord-test-"));
	tmpDirWithNoSocket = mkdtempSync(join(tmpdir(), "trpi-discord-empty-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	process.env.THINKRAIL_DISCORD_IPC_DIR = tmpDirWithNoSocket;
	resetDiscordForTests();
});

afterEach(() => {
	resetDiscordForTests();
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(tmpDirWithNoSocket, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
	if (savedIpcDir === undefined) delete process.env.THINKRAIL_DISCORD_IPC_DIR;
	else process.env.THINKRAIL_DISCORD_IPC_DIR = savedIpcDir;
});

test("Discord starting after a failed attempt is not noticed until the retry floor clears, but a settings change clears it immediately", async () => {
	updateConfig({
		discord: {
			enabled: true,
			applicationId: APPLICATION_ID,
			blockedProjectIds: [],
			shareFileName: true,
		},
	});
	applyDiscordSettings();
	expect((await getDiscordStatus()).state).toBe("unavailable");

	const socketDir = mkdtempSync(join(tmpdir(), "trpi-discord-fake-"));
	const server = startFakeDiscord(join(socketDir, "discord-ipc-0"));
	try {
		process.env.THINKRAIL_DISCORD_IPC_DIR = socketDir;

		// Still within the retry floor from the first failure: the socket now exists, but nothing
		// re-checks disk until either the floor elapses or the settings change resets it.
		expect((await getDiscordStatus()).state).toBe("unavailable");

		applyDiscordSettings();
		// applyDiscordSettings starts the reconnect but does not wait for it; poll for the handshake
		// the same way the client's settings-pane polling would.
		let state = (await getDiscordStatus()).state;
		for (let attempt = 0; state === "connecting" && attempt < 20; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 20));
			state = (await getDiscordStatus()).state;
		}
		expect(state).toBe("connected");
	} finally {
		server.close();
		rmSync(socketDir, { recursive: true, force: true });
	}
});
