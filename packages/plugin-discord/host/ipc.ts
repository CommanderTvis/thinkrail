import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const HEADER_BYTES = 8;
const MAX_FRAME_BYTES = 64 * 1024;
const READY_TIMEOUT_MS = 4000;

export interface DiscordActivity {
	/** The line above the project. Absent when there is no file name to show. */
	details: string | null;
	state: string;
	startedAt: number;
}

let darwinUserTempDir: string | null | undefined;

function resolveDarwinUserTempDir(): string | null {
	if (process.platform !== "darwin") return null;
	if (darwinUserTempDir !== undefined) return darwinUserTempDir;
	const probe = spawnSync("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], {
		encoding: "utf8",
		timeout: 2000,
	});
	const dir = probe.status === 0 ? probe.stdout.trim() : "";
	darwinUserTempDir = dir.length > 0 ? dir : null;
	return darwinUserTempDir;
}

function candidateDirs(): string[] {
	const override = process.env.THINKRAIL_DISCORD_IPC_DIR;
	if (override) return [override];
	const base = [
		process.env.XDG_RUNTIME_DIR,
		process.env.TMPDIR,
		process.env.TMP,
		process.env.TEMP,
		resolveDarwinUserTempDir(),
		"/tmp",
	].filter((dir): dir is string => typeof dir === "string" && dir.length > 0);
	return base.flatMap((dir) => [
		dir,
		join(dir, "app", "com.discordapp.Discord"),
		join(dir, "snap.discord"),
	]);
}

export function socketCandidates(): string[] {
	const paths: string[] = [];
	for (const dir of candidateDirs()) {
		for (let index = 0; index < 10; index += 1) {
			const path = join(dir, `discord-ipc-${index}`);
			if (!paths.includes(path)) paths.push(path);
		}
	}
	return paths;
}

function frame(op: number, payload: unknown): Buffer {
	const body = Buffer.from(JSON.stringify(payload), "utf8");
	const header = Buffer.alloc(HEADER_BYTES);
	header.writeUInt32LE(op, 0);
	header.writeUInt32LE(body.length, 4);
	return Buffer.concat([header, body]);
}

export class DiscordIpc {
	private socket: Socket | null = null;
	private pending = Buffer.alloc(0);
	private onClose: (() => void) | null = null;
	lastError: string | null = null;

	async connect(applicationId: string, onClose: () => void): Promise<void> {
		const paths = socketCandidates().filter((path) => existsSync(path));
		if (paths.length === 0) throw new Error("Discord is not running on this machine.");

		let lastError: unknown;
		for (const path of paths) {
			try {
				await this.handshake(path, applicationId);
				this.onClose = onClose;
				return;
			} catch (error) {
				lastError = error;
				this.close();
			}
		}
		throw lastError instanceof Error ? lastError : new Error("Could not reach Discord.");
	}

	private handshake(path: string, applicationId: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const socket = connect(path);
			this.socket = socket;

			const timer = setTimeout(() => {
				reject(new Error("Discord did not answer the handshake."));
				socket.destroy();
			}, READY_TIMEOUT_MS);

			const settle = (error?: Error) => {
				clearTimeout(timer);
				socket.off("error", onError);
				if (error) reject(error);
				else resolve();
			};
			const onError = (error: Error) => settle(error);

			socket.once("error", onError);
			socket.on("data", (chunk: Buffer) => {
				this.pending = Buffer.concat([this.pending, chunk]);
				for (const message of this.drain()) {
					if (message.op === OP_PING) this.send(OP_PONG, message.payload);
					if (message.op === OP_CLOSE) {
						settle(new Error("Discord closed the connection."));
						this.close();
						return;
					}
					const payload = message.payload as { evt?: unknown; data?: { message?: unknown } };
					if (payload.evt === "ERROR")
						this.lastError =
							typeof payload.data?.message === "string"
								? payload.data.message
								: "Discord rejected the request.";
					if (payload.evt === "READY") settle();
				}
			});
			socket.on("close", () => {
				const notify = this.onClose;
				this.onClose = null;
				this.socket = null;
				notify?.();
			});
			socket.once("connect", () => {
				this.send(OP_HANDSHAKE, { v: 1, client_id: applicationId });
			});
		});
	}

	private *drain(): Generator<{ op: number; payload: unknown }> {
		while (this.pending.length >= HEADER_BYTES) {
			const op = this.pending.readUInt32LE(0);
			const length = this.pending.readUInt32LE(4);
			if (length > MAX_FRAME_BYTES) {
				this.pending = Buffer.alloc(0);
				return;
			}
			if (this.pending.length < HEADER_BYTES + length) return;
			const body = this.pending.subarray(HEADER_BYTES, HEADER_BYTES + length).toString("utf8");
			this.pending = this.pending.subarray(HEADER_BYTES + length);
			try {
				yield { op, payload: JSON.parse(body) as unknown };
			} catch {
				return;
			}
		}
	}

	private send(op: number, payload: unknown): void {
		this.socket?.write(frame(op, payload));
	}

	setActivity(activity: DiscordActivity | null): void {
		if (!this.socket) return;
		this.send(OP_FRAME, {
			cmd: "SET_ACTIVITY",
			nonce: randomUUID(),
			args: {
				pid: process.pid,
				activity: activity
					? {
							type: 0,
							...(activity.details === null ? {} : { details: activity.details }),
							state: activity.state,
							timestamps: { start: activity.startedAt },
						}
					: null,
			},
		});
	}

	get connected(): boolean {
		return this.socket !== null;
	}

	close(): void {
		this.onClose = null;
		this.socket?.destroy();
		this.socket = null;
		this.pending = Buffer.alloc(0);
	}
}
