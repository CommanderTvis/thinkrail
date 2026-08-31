import { expect, test } from "bun:test";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { ChatCapabilities, ChatEvent, SessionId } from "@thinkrail/contracts";
import type { AcpClientDelegates } from "../client";
import { connectAgent } from "./connect";
import { AcpSpawnError, AcpVersionError } from "./errors";
import type { ConnectAgentOptions, ProcessSpawner, SpawnedProcess } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface JsonRpcCall {
	id: number | string | null;
	method: string;
	params?: unknown;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

class FakeAgent {
	readonly process: SpawnedProcess;
	readonly killed: string[] = [];
	#calls: JsonRpcCall[] = [];
	#cursor = 0;
	#buffer = "";
	#stdinEnded = false;
	#gone = false;
	readonly #stdout = new TransformStream<Uint8Array, Uint8Array>();
	readonly #stderr = new TransformStream<Uint8Array, Uint8Array>();
	readonly #stdoutWriter = this.#stdout.writable.getWriter();
	readonly #stderrWriter = this.#stderr.writable.getWriter();
	readonly #exit = deferred<{ code: number | null; signal: string | null }>();

	constructor() {
		this.process = {
			stdin: new WritableStream<Uint8Array>({
				write: (chunk) => {
					this.#receive(decoder.decode(chunk));
				},
				close: () => {
					this.#stdinEnded = true;
					this.#leave(0, null);
				},
				abort: () => {
					this.#stdinEnded = true;
					this.#leave(0, null);
				},
			}),
			stdout: this.#stdout.readable,
			stderr: this.#stderr.readable,
			exited: this.#exit.promise,
			kill: (signal) => {
				this.killed.push(signal);
				this.#leave(null, signal);
			},
		};
	}

	get spawner(): ProcessSpawner {
		return () => this.process;
	}

	get stdinEnded(): boolean {
		return this.#stdinEnded;
	}

	async waitFor(method: string): Promise<JsonRpcCall> {
		for (let attempt = 0; attempt < 500; attempt += 1) {
			while (this.#cursor < this.#calls.length) {
				const call = this.#calls[this.#cursor];
				this.#cursor += 1;
				if (call !== undefined && call.method === method) return call;
			}
			await Bun.sleep(1);
		}
		throw new Error(`the client never sent ${method}`);
	}

	async reply(call: JsonRpcCall, result: unknown): Promise<void> {
		await this.writeStdout(`${JSON.stringify({ jsonrpc: "2.0", id: call.id, result })}\n`);
	}

	async writeStdout(text: string): Promise<void> {
		await this.#stdoutWriter.write(encoder.encode(text));
	}

	async writeStderr(text: string): Promise<void> {
		await this.#stderrWriter.write(encoder.encode(text));
	}

	crash(code: number): void {
		this.#leave(code, null);
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
			if (line.length > 0) this.#calls.push(JSON.parse(line) as JsonRpcCall);
		}
	}
}

function unsupported(name: string): () => never {
	return () => {
		throw new Error(`${name} is not exercised by this test`);
	};
}

function delegates(
	publish: (sessionId: SessionId, events: ChatEvent[]) => void,
): AcpClientDelegates {
	return {
		readTextFile: unsupported("readTextFile"),
		writeTextFile: unsupported("writeTextFile"),
		createTerminal: unsupported("createTerminal"),
		terminalOutput: unsupported("terminalOutput"),
		waitForTerminalExit: unsupported("waitForTerminalExit"),
		killTerminal: unsupported("killTerminal"),
		releaseTerminal: unsupported("releaseTerminal"),
		requestPermission: unsupported("requestPermission"),
		createElicitation: unsupported("createElicitation"),
		completeElicitation: unsupported("completeElicitation"),
		openMcpEndpoint: unsupported("openMcpEndpoint"),
		publish,
	};
}

interface Watchers {
	publish?: (sessionId: SessionId, events: ChatEvent[]) => void;
	onCapabilities?: (capabilities: ChatCapabilities) => void;
}

function options(spawn: ProcessSpawner, watchers: Watchers = {}): ConnectAgentOptions {
	let counter = 0;
	const nextId = (): string => {
		counter += 1;
		return `m${counter}`;
	};
	return {
		agent: { id: "fake", name: "Fake", origin: "external" },
		launch: { command: "fake-agent", args: [] },
		delegates: delegates(watchers.publish ?? (() => undefined)),
		clock: { now: () => 1_700_000_000_000, nextId },
		spawn,
		handshakeTimeoutMs: 2_000,
		...(watchers.onCapabilities !== undefined ? { onCapabilities: watchers.onCapabilities } : {}),
	};
}

async function connected(
	fake: FakeAgent,
	watchers: Watchers = {},
	initializeResult: Record<string, unknown> = {},
): ReturnType<typeof connectAgent> {
	const connecting = connectAgent(options(fake.spawner, watchers));
	const initialize = await fake.waitFor("initialize");
	await fake.reply(initialize, {
		protocolVersion: PROTOCOL_VERSION,
		agentInfo: { name: "fake", version: "9.9.9" },
		...initializeResult,
	});
	return await connecting;
}

const MODEL_OPTION = {
	id: "model",
	name: "Model",
	category: "model",
	type: "select",
	currentValue: "a",
	options: [{ value: "a", name: "Model A" }],
};

test("a missing binary is a launch failure, told apart from one that is merely not executable", async () => {
	const missing: ProcessSpawner = () => {
		throw Object.assign(new Error('Executable not found in $PATH: "fake-agent"'), {
			code: "ENOENT",
		});
	};
	const blocked: ProcessSpawner = () => {
		throw Object.assign(new Error("permission denied"), { code: "EACCES" });
	};

	const first = await connectAgent(options(missing)).catch((error: unknown) => error);
	if (!(first instanceof AcpSpawnError)) throw new Error("expected AcpSpawnError");
	expect(first.reason).toBe("not-found");
	expect(first.command).toBe("fake-agent");

	const second = await connectAgent(options(blocked)).catch((error: unknown) => error);
	if (!(second instanceof AcpSpawnError)) throw new Error("expected AcpSpawnError");
	expect(second.reason).toBe("not-executable");
});

test("a banner before the first message is diverted, not fatal", async () => {
	const fake = new FakeAgent();
	const connecting = connectAgent(options(fake.spawner));
	await fake.writeStdout("fake-agent 1.0.0\n");
	await fake.writeStdout("[info] listening on stdio\n");
	const initialize = await fake.waitFor("initialize");
	await fake.reply(initialize, {
		protocolVersion: PROTOCOL_VERSION,
		agentInfo: { name: "fake", version: "9.9.9" },
	});

	const connection = await connecting;
	expect(connection.agent.protocolVersion).toBe(PROTOCOL_VERSION);
	expect(connection.agent.version).toBe("9.9.9");

	const exit = await connection.close();
	expect(exit.stdoutNoise).toContain("fake-agent 1.0.0");
	expect(exit.stdoutNoise).toContain("[info] listening on stdio");
});

test("a protocol version we do not speak is refused and the process reaped", async () => {
	const fake = new FakeAgent();
	const connecting = connectAgent(options(fake.spawner));
	await fake.reply(await fake.waitFor("initialize"), { protocolVersion: PROTOCOL_VERSION + 1 });

	const refused = await connecting.catch((error: unknown) => error);
	if (!(refused instanceof AcpVersionError)) throw new Error("expected AcpVersionError");
	expect(refused.received).toBe(PROTOCOL_VERSION + 1);
	expect(refused.expected).toBe(PROTOCOL_VERSION);
	expect(fake.stdinEnded).toBe(true);
});

test("an agent that dies mid-turn settles the turn as failed and says why", async () => {
	const fake = new FakeAgent();
	const published: { sessionId: SessionId; events: ChatEvent[] }[] = [];
	const connection = await connected(fake, {
		publish: (sessionId, events) => {
			published.push({ sessionId, events });
		},
	});

	const opening = connection.newSession({ cwd: "/tmp/worktree" });
	await fake.reply(await fake.waitFor("session/new"), { sessionId: "s1" });
	const handle = await opening;

	const prompting = connection.prompt({
		sessionId: handle.sessionId,
		content: [{ type: "text", text: "go" }],
	});
	await fake.waitFor("session/prompt");
	await fake.writeStderr("panic: provider exploded\n");
	fake.crash(1);

	const outcome = await prompting;
	expect(outcome.settlement.stopReason).toBe("failed");
	expect(outcome.settlement.error).toContain("panic: provider exploded");

	const events = published.flatMap((batch) => batch.events);
	const settled = events.find((event) => event.type === "turn_settled");
	if (settled?.type !== "turn_settled") throw new Error("the turn never settled");
	expect(settled.message.marker.stopReason).toBe("failed");
	expect(events.map((event) => event.type)).toEqual([
		"message_start",
		"turn_start",
		"turn_settled",
	]);

	const exit = await connection.exited;
	expect(exit.code).toBe(1);
	expect(exit.stderrTail).toContain("panic: provider exploded");
});

test("close ends stdin, reaps the process and reports the exit", async () => {
	const fake = new FakeAgent();
	const connection = await connected(fake);

	const exit = await connection.close();
	expect(fake.stdinEnded).toBe(true);
	expect(fake.killed).toEqual([]);
	expect(exit.code).toBe(0);
	expect(exit.signal).toBeNull();
	expect(connection.signal.aborted).toBe(true);
	expect(await connection.close()).toEqual(exit);
});

test("what the agent publishes widens the capability record, and only the first time", async () => {
	const fake = new FakeAgent();
	const widened: ChatCapabilities[] = [];
	const published: ChatEvent[] = [];
	const connection = await connected(fake, {
		publish: (_sessionId, events) => {
			published.push(...events);
		},
		onCapabilities: (capabilities) => {
			widened.push(capabilities);
		},
	});
	expect(connection.capabilities.modelPicker).toBe(false);

	const opening = connection.newSession({ cwd: "/tmp/worktree" });
	await fake.reply(await fake.waitFor("session/new"), {
		sessionId: "s1",
		configOptions: [MODEL_OPTION],
	});
	await opening;

	expect(connection.capabilities.modelPicker).toBe(true);
	expect(connection.capabilities.derivedFrom.modelPicker).toBe("observed");
	expect(widened).toHaveLength(1);
	expect(published.filter((event) => event.type === "capabilities")).toHaveLength(1);

	const setting = connection.setConfigOption({
		sessionId: "s1",
		optionId: "model",
		value: "a",
	});
	await fake.reply(await fake.waitFor("session/set_config_option"), {
		configOptions: [MODEL_OPTION],
	});
	await setting;
	expect(widened).toHaveLength(1);

	await connection.close();
});

test("authMethods is captured once from initialize and translated", async () => {
	const fake = new FakeAgent();
	const connection = await connected(
		fake,
		{},
		{
			authMethods: [
				{ id: "oauth", name: "Sign in" },
				{ type: "env_var", id: "key", name: "API key", vars: [{ name: "OPENAI_API_KEY" }] },
			],
		},
	);
	expect(connection.authMethods).toEqual([
		{ id: "oauth", name: "Sign in", kind: "agent" },
		{ id: "key", name: "API key", kind: "envVar", envVars: [{ name: "OPENAI_API_KEY" }] },
	]);
	await connection.close();
});

test("an agent that advertises no auth methods reports an empty list, not an error", async () => {
	const fake = new FakeAgent();
	const connection = await connected(fake);
	expect(connection.authMethods).toEqual([]);
	await connection.close();
});

test("listProviders resolves to an empty list, with no request sent, when the agent has no providers capability", async () => {
	const fake = new FakeAgent();
	const connection = await connected(fake);
	expect(await connection.listProviders()).toEqual([]);
	await connection.close();
});

test("listProviders calls providers/list and translates the response when advertised", async () => {
	const fake = new FakeAgent();
	const connection = await connected(fake, {}, { agentCapabilities: { providers: {} } });

	const listing = connection.listProviders();
	await fake.reply(await fake.waitFor("providers/list"), {
		providers: [{ providerId: "main", supported: ["anthropic"], required: true, current: null }],
	});
	expect(await listing).toEqual([
		{ id: "main", required: true, configured: false, protocols: ["anthropic"] },
	]);
	await connection.close();
});

test("setProvider and disableProvider refuse before sending a request when unsupported", async () => {
	const fake = new FakeAgent();
	const connection = await connected(fake);
	await expect(
		connection.setProvider({ providerId: "main", apiType: "anthropic", baseUrl: "https://x" }),
	).rejects.toThrow(/does not support provider configuration/);
	await expect(connection.disableProvider("main")).rejects.toThrow(
		/does not support provider configuration/,
	);
	await connection.close();
});

test("setProvider and disableProvider send the request the agent expects, once advertised", async () => {
	const fake = new FakeAgent();
	const connection = await connected(fake, {}, { agentCapabilities: { providers: {} } });

	const setting = connection.setProvider({
		providerId: "main",
		apiType: "anthropic",
		baseUrl: "https://api.anthropic.com",
		headers: { Authorization: "Bearer token" },
	});
	const setCall = await fake.waitFor("providers/set");
	expect(setCall.params).toEqual({
		providerId: "main",
		apiType: "anthropic",
		baseUrl: "https://api.anthropic.com",
		headers: { Authorization: "Bearer token" },
	});
	await fake.reply(setCall, {});
	await setting;

	const disabling = connection.disableProvider("spare");
	const disableCall = await fake.waitFor("providers/disable");
	expect(disableCall.params).toEqual({ providerId: "spare" });
	await fake.reply(disableCall, {});
	await disabling;

	await connection.close();
});
