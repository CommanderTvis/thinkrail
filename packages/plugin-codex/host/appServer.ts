import { spawn } from "node:child_process";
import { homedir } from "node:os";

export function codexExecutable(command: string): string {
	const match = /^(?:"([^"]+)"|'([^']+)'|([^\s'";|&<>`$()]+))(?:\s|$)/.exec(command.trim());
	const executable = match?.[1] ?? match?.[2] ?? match?.[3];
	if (!executable || executable.startsWith("-") || /^\w+=/.test(executable)) {
		throw new Error("The Codex command must start with an executable path.");
	}
	return executable;
}

export function createAppServer(executable: string, timeoutMs = 15_000) {
	const child = spawn(executable, ["app-server"], {
		cwd: homedir(),
		env: process.env,
		stdio: ["pipe", "pipe", "ignore"],
		windowsHide: true,
		detached: process.platform !== "win32",
	});
	let failure: Error | null = null;
	let sequence = 0;
	let buffer = "";
	let killTimer: ReturnType<typeof setTimeout> | undefined;
	const pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	const closed = new Promise<void>((resolve) => {
		child.once("close", () => {
			fail(new Error("Codex app-server exited."));
			kill("SIGKILL");
			clearTimeout(killTimer);
			resolve();
		});
	});

	function kill(signal: NodeJS.Signals): void {
		if (!child.pid) return;
		if (process.platform !== "win32") {
			try {
				process.kill(-child.pid, signal);
			} catch {
				child.kill(signal);
			}
		} else if (child.exitCode === null && child.signalCode === null) {
			const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
			});
			killer.on("error", () => child.kill("SIGKILL"));
		}
	}

	function fail(error: Error): void {
		if (failure) return;
		failure = error;
		for (const request of pending.values()) {
			clearTimeout(request.timer);
			request.reject(error);
		}
		pending.clear();
		child.stdin.destroy();
		kill("SIGTERM");
		killTimer = setTimeout(() => kill("SIGKILL"), 1_000);
		killTimer.unref();
	}

	function send(message: unknown): void {
		if (failure) throw failure;
		child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	function request(method: string, params: unknown = {}): Promise<unknown> {
		if (failure) return Promise.reject(failure);
		return new Promise((resolve, reject) => {
			const id = ++sequence;
			const timer = setTimeout(() => fail(new Error(`Codex ${method} timed out.`)), timeoutMs);
			pending.set(id, { resolve, reject, timer });
			try {
				send({ id, method, params });
			} catch (error) {
				fail(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	child.once("error", (error) =>
		fail(new Error(`Could not start Codex app-server: ${error.message}`)),
	);
	child.stdin.on("error", fail);
	child.stdout.on("error", fail);
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		buffer += chunk;
		if (buffer.length > 1_048_576) {
			fail(new Error("Codex app-server response exceeded the size limit."));
			return;
		}
		let newline = buffer.indexOf("\n");
		while (newline !== -1) {
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			try {
				const message: unknown = JSON.parse(line);
				if (!isRecord(message)) throw new Error("Invalid Codex app-server response.");
				if (typeof message.method === "string") {
					if ("id" in message) {
						send({ id: message.id, error: { code: -32601, message: "Method not supported" } });
					}
				} else if (typeof message.id === "number") {
					const call = pending.get(message.id);
					if (call) {
						if (!("result" in message) && !isRecord(message.error)) {
							throw new Error("Invalid Codex app-server response.");
						}
						pending.delete(message.id);
						clearTimeout(call.timer);
						if (isRecord(message.error)) {
							call.reject(new Error(String(message.error.message ?? "Codex request failed.")));
						} else call.resolve(message.result);
					}
				}
			} catch (error) {
				fail(error instanceof Error ? error : new Error("Invalid Codex app-server response."));
				return;
			}
			newline = buffer.indexOf("\n");
		}
	});

	const ready = request("initialize", {
		clientInfo: { name: "thinkrail", title: "ThinkRail", version: "0.1.0" },
	})
		.then(() => send({ method: "initialized", params: {} }))
		.catch(fail);

	return {
		get alive() {
			return failure === null;
		},
		async request(method: string, params: unknown = {}): Promise<unknown> {
			await ready;
			return request(method, params);
		},
		stop() {
			fail(new Error("Codex app-server stopped."));
			return closed;
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
