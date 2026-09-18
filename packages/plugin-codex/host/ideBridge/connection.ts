import { chmodSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { type Message, read } from "./protocol";
import { attachRouter } from "./router";

function metadata(path: string) {
	try {
		return lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

function prepare(path: string): ReturnType<typeof metadata> {
	if (process.platform === "win32") return null;
	const parent = dirname(path);
	mkdirSync(parent, { recursive: true, mode: 0o700 });
	const directory = lstatSync(parent);
	if (!directory.isDirectory() || directory.uid !== process.getuid?.() || directory.mode & 0o022)
		throw new Error(
			"Codex IPC directory must be owned by the current user and not writable by others",
		);
	const socket = metadata(path);
	if (socket && (!socket.isSocket() || socket.uid !== process.getuid?.()))
		throw new Error("Codex IPC path is not a socket owned by the current user");
	return socket;
}

export function connectRouter(
	path: string,
	connected: (socket: Socket) => void,
	receive: (socket: Socket, message: Message) => void,
	warn: (error: unknown) => void,
): () => void {
	let stopped = false;
	let socket: Socket | undefined;
	let server: Server | undefined;
	let stopRouter: (() => void) | undefined;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let lastError = "";

	function again() {
		if (!stopped && !retry)
			retry = setTimeout(() => {
				retry = undefined;
				attempt();
			}, 1000);
	}

	function report(error: unknown) {
		const message = String(error);
		if (message !== lastError) warn(error);
		lastError = message;
	}

	function listen() {
		if (stopped || server) {
			again();
			return;
		}
		const listener = createServer();
		server = listener;
		const disposeRouter = attachRouter(listener);
		stopRouter = disposeRouter;
		listener.on("error", (error: NodeJS.ErrnoException) => {
			disposeRouter();
			if (server === listener) server = undefined;
			if (error.code !== "EADDRINUSE") report(error);
			again();
		});
		listener.listen(path, () => {
			if (stopped) {
				listener.close();
				return;
			}
			try {
				if (process.platform !== "win32") chmodSync(path, 0o600);
			} catch (error) {
				report(error);
				listener.close();
				return;
			}
			attempt();
		});
	}

	function attempt() {
		if (stopped) return;
		let before: ReturnType<typeof metadata>;
		try {
			before = prepare(path);
		} catch (error) {
			report(error);
			again();
			return;
		}
		const client = connect(path);
		socket = client;
		let failed = false;
		const timer = setTimeout(
			() => client.destroy(new Error("Codex IPC connection timed out")),
			1500,
		);
		client.once("connect", () => {
			clearTimeout(timer);
			lastError = "";
			connected(client);
		});
		client.once("error", (error: NodeJS.ErrnoException) => {
			failed = true;
			clearTimeout(timer);
			if (stopped) return;
			if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
				try {
					if (error.code === "ECONNREFUSED" && before) {
						const now = prepare(path);
						if (now?.ino === before.ino && now.dev === before.dev) unlinkSync(path);
					}
					listen();
				} catch (failure) {
					report(failure);
					again();
				}
			} else {
				report(error);
				again();
			}
		});
		read(client, (message) => receive(client, message));
		client.once("close", () => {
			clearTimeout(timer);
			if (!failed) again();
		});
	}

	attempt();
	return () => {
		stopped = true;
		clearTimeout(retry);
		socket?.destroy();
		stopRouter?.();
		server?.close();
	};
}
