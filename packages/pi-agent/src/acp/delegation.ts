import type {
	ClientRequestMethod,
	ClientRequestParamsByMethod,
	ClientRequestResponsesByMethod,
	EnvVariable,
	TerminalOutputResponse,
} from "@agentclientprotocol/sdk";
import { methods } from "@agentclientprotocol/sdk";
import type {
	BashOperations,
	EditOperations,
	ReadOperations,
	SettingsManager,
	ToolDefinition,
	WriteOperations,
} from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	defineTool,
} from "@earendil-works/pi-coding-agent";
import type { SessionToolBinding } from "../engine";
import type { NegotiatedClient } from "./capabilities";

const POLL_INTERVAL_MS = 100;
const OUTPUT_BYTE_LIMIT = 2_000_000;

export interface DelegatedClient {
	request<Method extends ClientRequestMethod>(
		method: Method,
		params: ClientRequestParamsByMethod[Method],
	): Promise<ClientRequestResponsesByMethod[Method]>;
}

export interface DelegationTarget {
	client(): DelegatedClient | null;
	binding: SessionToolBinding;
}

function reach(target: DelegationTarget): { client: DelegatedClient; sessionId: string } {
	const client = target.client();
	const sessionId = target.binding.sessionId;
	if (client === null || sessionId === null) {
		throw new Error("The ThinkRail host is not attached to this session.");
	}
	return { client, sessionId };
}

function readTextFile(target: DelegationTarget): (path: string) => Promise<string> {
	return async (path) => {
		const { client, sessionId } = reach(target);
		const response = await client.request(methods.client.fs.readTextFile, { sessionId, path });
		return response.content;
	};
}

export function delegatedRead(target: DelegationTarget): ReadOperations {
	const read = readTextFile(target);
	return {
		readFile: async (absolutePath) => Buffer.from(await read(absolutePath), "utf8"),
		access: async (absolutePath) => {
			await read(absolutePath);
		},
	};
}

export function delegatedWrite(target: DelegationTarget): WriteOperations {
	return {
		writeFile: async (absolutePath, content) => {
			const { client, sessionId } = reach(target);
			await client.request(methods.client.fs.writeTextFile, {
				sessionId,
				path: absolutePath,
				content,
			});
		},
		mkdir: async () => {},
	};
}

export function delegatedEdit(target: DelegationTarget): EditOperations {
	const read = readTextFile(target);
	const write = delegatedWrite(target);
	return {
		readFile: async (absolutePath) => Buffer.from(await read(absolutePath), "utf8"),
		writeFile: write.writeFile,
		access: async (absolutePath) => {
			await read(absolutePath);
		},
	};
}

function envVariables(env: NodeJS.ProcessEnv | undefined): EnvVariable[] {
	if (env === undefined) return [];
	const variables: EnvVariable[] = [];
	for (const [name, value] of Object.entries(env)) {
		if (typeof value === "string") variables.push({ name, value });
	}
	return variables;
}

function exitCodeOf(response: { exitCode?: number | null; signal?: string | null }): number | null {
	if (typeof response.exitCode === "number") return response.exitCode;
	return response.signal != null ? null : 0;
}

export function delegatedBash(target: DelegationTarget): BashOperations {
	return {
		exec: async (command, cwd, options) => {
			const { client, sessionId } = reach(target);
			const created = await client.request(methods.client.terminal.create, {
				sessionId,
				command: "bash",
				args: ["-lc", command],
				cwd,
				env: envVariables(options.env),
				outputByteLimit: OUTPUT_BYTE_LIMIT,
			});
			const terminalId = created.terminalId;
			let delivered = 0;
			const drain = (response: TerminalOutputResponse): void => {
				const chunk = response.output.slice(delivered);
				if (chunk.length === 0) return;
				delivered = response.output.length;
				options.onData(Buffer.from(chunk, "utf8"));
			};
			const kill = (): void => {
				void client
					.request(methods.client.terminal.kill, { sessionId, terminalId })
					.catch(() => undefined);
			};
			if (options.signal?.aborted === true) kill();
			else options.signal?.addEventListener("abort", kill, { once: true });
			const deadline =
				options.timeout === undefined ? undefined : setTimeout(kill, options.timeout);
			try {
				const exited = client.request(methods.client.terminal.waitForExit, {
					sessionId,
					terminalId,
				});
				let running = true;
				void exited.then(
					() => {
						running = false;
					},
					() => {
						running = false;
					},
				);
				while (running) {
					await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
					const snapshot = await client
						.request(methods.client.terminal.output, { sessionId, terminalId })
						.catch(() => undefined);
					if (snapshot !== undefined) drain(snapshot);
				}
				const status = await exited;
				const final = await client
					.request(methods.client.terminal.output, { sessionId, terminalId })
					.catch(() => undefined);
				if (final !== undefined) drain(final);
				return { exitCode: exitCodeOf(status) };
			} finally {
				if (deadline !== undefined) clearTimeout(deadline);
				options.signal?.removeEventListener("abort", kill);
				await client
					.request(methods.client.terminal.release, { sessionId, terminalId })
					.catch(() => undefined);
			}
		},
	};
}

export function delegatedToolDefinitions(
	cwd: string,
	settings: SettingsManager,
	target: DelegationTarget,
	client: NegotiatedClient,
): ToolDefinition[] {
	if (!client.readTextFile && !client.writeTextFile && !client.terminal) return [];
	const commandPrefix = settings.getShellCommandPrefix();
	const shellPath = settings.getShellPath();
	return [
		defineTool(
			createReadToolDefinition(cwd, {
				autoResizeImages: settings.getImageAutoResize(),
				...(client.readTextFile ? { operations: delegatedRead(target) } : {}),
			}),
		),
		defineTool(
			createWriteToolDefinition(cwd, {
				...(client.writeTextFile ? { operations: delegatedWrite(target) } : {}),
			}),
		),
		defineTool(
			createEditToolDefinition(cwd, {
				...(client.readTextFile && client.writeTextFile
					? { operations: delegatedEdit(target) }
					: {}),
			}),
		),
		defineTool(
			createBashToolDefinition(cwd, {
				...(commandPrefix !== undefined ? { commandPrefix } : {}),
				...(shellPath !== undefined ? { shellPath } : {}),
				...(client.terminal ? { operations: delegatedBash(target) } : {}),
			}),
		),
	];
}
