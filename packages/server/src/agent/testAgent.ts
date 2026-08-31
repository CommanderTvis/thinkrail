import type { ProcessSpawner, SpawnedProcess } from "@thinkrail/acp";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface JsonRpcCall {
	id: number | string | null;
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcAnswer {
	id: number | string | null;
	result?: unknown;
	error?: { code: number; message: string };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

export interface ScriptedAgentOptions {
	agentCapabilities?: Record<string, unknown>;
	authMethods?: unknown[];
	meta?: Record<string, unknown>;
	sessionConfigOptions?: unknown[];
}

export class ScriptedAgent {
	readonly process: SpawnedProcess;
	readonly calls: JsonRpcCall[] = [];
	readonly answers: JsonRpcAnswer[] = [];
	#requestSeq = 0;
	#cursor = 0;
	#buffer = "";
	#gone = false;
	#sessionSeq = 0;
	#options: ScriptedAgentOptions = {};
	readonly #stdout = new TransformStream<Uint8Array, Uint8Array>();
	readonly #stderr = new TransformStream<Uint8Array, Uint8Array>();
	readonly #stdoutWriter = this.#stdout.writable.getWriter();
	readonly #stderrWriter = this.#stderr.writable.getWriter();
	readonly #exit = deferred<{ code: number | null; signal: string | null }>();
	autoAnswer = true;

	constructor(options: ScriptedAgentOptions = {}) {
		this.#options = options;
		this.process = {
			stdin: new WritableStream<Uint8Array>({
				write: (chunk) => {
					this.#receive(decoder.decode(chunk));
				},
				close: () => this.#leave(0, null),
				abort: () => this.#leave(0, null),
			}),
			stdout: this.#stdout.readable,
			stderr: this.#stderr.readable,
			exited: this.#exit.promise,
			kill: (signal) => this.#leave(null, signal),
		};
	}

	get spawner(): ProcessSpawner {
		return () => this.process;
	}

	async waitFor(method: string): Promise<JsonRpcCall> {
		for (let attempt = 0; attempt < 1_000; attempt += 1) {
			while (this.#cursor < this.calls.length) {
				const call = this.calls[this.#cursor];
				this.#cursor += 1;
				if (call !== undefined && call.method === method) return call;
			}
			await Bun.sleep(1);
		}
		throw new Error(`the host never sent ${method}`);
	}

	sent(method: string): JsonRpcCall[] {
		return this.calls.filter((call) => call.method === method);
	}

	async reply(call: JsonRpcCall, result: unknown): Promise<void> {
		await this.#write(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
	}

	async reject(call: JsonRpcCall, message: string, code = -32603): Promise<void> {
		await this.#write(JSON.stringify({ jsonrpc: "2.0", id: call.id, error: { code, message } }));
	}

	async request(method: string, params: Record<string, unknown>): Promise<number> {
		this.#requestSeq += 1;
		const id = this.#requestSeq;
		await this.#write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
		return id;
	}

	async awaitResponse(): Promise<JsonRpcAnswer> {
		for (let attempt = 0; attempt < 1_000; attempt += 1) {
			const answer = this.answers.shift();
			if (answer !== undefined) return answer;
			await Bun.sleep(1);
		}
		throw new Error("the host never answered");
	}

	async notify(method: string, params: Record<string, unknown>): Promise<void> {
		await this.#write(JSON.stringify({ jsonrpc: "2.0", method, params }));
	}

	async update(sessionId: string, update: Record<string, unknown>): Promise<void> {
		await this.notify("session/update", { sessionId, update });
	}

	crash(code: number, stderr = ""): void {
		if (stderr.length > 0) void this.#stderrWriter.write(encoder.encode(stderr));
		this.#leave(code, null);
	}

	async #write(line: string): Promise<void> {
		await this.#stdoutWriter.write(encoder.encode(`${line}\n`));
	}

	#leave(code: number | null, signal: string | null): void {
		if (this.#gone) return;
		this.#gone = true;
		this.#exit.resolve({ code, signal });
		void this.#stderrWriter.close().catch(() => undefined);
		void this.#stdoutWriter.close().catch(() => undefined);
	}

	#receive(text: string): void {
		this.#buffer += text;
		for (;;) {
			const newline = this.#buffer.indexOf("\n");
			if (newline < 0) break;
			const line = this.#buffer.slice(0, newline).trim();
			this.#buffer = this.#buffer.slice(newline + 1);
			if (line.length === 0) continue;
			const message = JSON.parse(line) as JsonRpcCall & JsonRpcAnswer;
			if (typeof message.method !== "string") {
				this.answers.push({
					id: message.id,
					...(message.result === undefined ? {} : { result: message.result }),
					...(message.error === undefined ? {} : { error: message.error }),
				});
				continue;
			}
			this.calls.push(message);
			if (this.autoAnswer) void this.#answer(message);
		}
	}

	async #answer(call: JsonRpcCall): Promise<void> {
		if (call.id === null || call.id === undefined) return;
		switch (call.method) {
			case "initialize":
				await this.reply(call, {
					protocolVersion: call.params?.protocolVersion,
					agentInfo: { name: "scripted", version: "1.0.0" },
					...(this.#options.agentCapabilities === undefined
						? {}
						: { agentCapabilities: this.#options.agentCapabilities }),
					...(this.#options.authMethods === undefined
						? {}
						: { authMethods: this.#options.authMethods }),
					...(this.#options.meta === undefined ? {} : { _meta: this.#options.meta }),
				});
				return;
			case "session/new":
				this.#sessionSeq += 1;
				await this.reply(call, {
					sessionId: `s${this.#sessionSeq}`,
					...(this.#options.sessionConfigOptions === undefined
						? {}
						: { configOptions: this.#options.sessionConfigOptions }),
				});
				return;
			case "session/load":
			case "session/close":
			case "session/delete":
				await this.reply(call, {});
				return;
			default:
				return;
		}
	}
}
