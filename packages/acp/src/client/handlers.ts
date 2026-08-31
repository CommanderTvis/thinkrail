import type {
	ClientApp,
	ClientRequestHandler,
	ConnectMcpRequest,
	ConnectMcpResponse,
	DisconnectMcpRequest,
	DisconnectMcpResponse,
	MessageMcpRequest,
	MessageMcpResponse,
} from "@agentclientprotocol/sdk";
import { CLIENT_METHODS, RequestError } from "@agentclientprotocol/sdk";
import {
	toElicitationOutcome,
	toElicitationRequest,
	toPermissionOutcome,
	toPermissionRequest,
} from "../translate";
import { McpAcpBridge, parseConnectMcp, parseDisconnectMcp, parseMessageMcp } from "./mcpBridge";
import type { AcpClientDelegates, AcpClientRuntime } from "./types";

function asRequestError(error: unknown): RequestError {
	if (error instanceof RequestError) return error;
	if (typeof error === "object" && error !== null) {
		const raw = error as { name?: unknown; code?: unknown; message?: unknown; data?: unknown };
		if (raw.name === "RequestError" && typeof raw.code === "number") {
			const message = typeof raw.message === "string" ? raw.message : "Request failed";
			return new RequestError(raw.code, message, raw.data);
		}
	}
	return RequestError.internalError(undefined, describeHostError(error));
}

function describeHostError(error: unknown): string {
	if (typeof error === "string" && error.length > 0) return error;
	if (error instanceof Error && error.message.length > 0) return error.message;
	return "the host could not serve this request";
}

function serving<Params, Response>(
	run: (params: Params) => Promise<Response>,
): ClientRequestHandler<Params, Response> {
	return async (context) => {
		try {
			return await run(context.params);
		} catch (error) {
			throw asRequestError(error);
		}
	};
}

export function registerClientHandlers(
	app: ClientApp,
	delegates: AcpClientDelegates,
	runtime: AcpClientRuntime,
): ClientApp {
	const mcp = new McpAcpBridge(delegates, runtime);

	app.onNotification(CLIENT_METHODS.session_update, ({ params }) => {
		runtime.applyUpdate(params);
	});

	app.onNotification(CLIENT_METHODS.elicitation_complete, ({ params }) => {
		delegates.completeElicitation(params.elicitationId);
	});

	app.onRequest(
		CLIENT_METHODS.session_request_permission,
		serving(async (params) => {
			const request = toPermissionRequest(params, runtime.nextId());
			return { outcome: toPermissionOutcome(await delegates.requestPermission(request)) };
		}),
	);

	app.onRequest(
		CLIENT_METHODS.elicitation_create,
		serving(async (params) => {
			const request = toElicitationRequest(params, runtime.nextId());
			if (request === undefined) return { action: "decline" };
			return toElicitationOutcome(await delegates.createElicitation(request));
		}),
	);

	app.onRequest(
		CLIENT_METHODS.fs_read_text_file,
		serving(async (params) => {
			const line = params.line ?? undefined;
			const limit = params.limit ?? undefined;
			const content = await delegates.readTextFile({
				sessionId: params.sessionId,
				path: params.path,
				...(line !== undefined ? { line } : {}),
				...(limit !== undefined ? { limit } : {}),
			});
			return { content };
		}),
	);

	app.onRequest(
		CLIENT_METHODS.fs_write_text_file,
		serving(async (params) => {
			await delegates.writeTextFile({
				sessionId: params.sessionId,
				path: params.path,
				content: params.content,
			});
			return {};
		}),
	);

	app.onRequest(
		CLIENT_METHODS.terminal_create,
		serving(async (params) => {
			const env: Record<string, string> = {};
			for (const variable of params.env ?? []) env[variable.name] = variable.value;
			const cwd = params.cwd ?? undefined;
			const outputByteLimit = params.outputByteLimit ?? undefined;
			const terminalId = await delegates.createTerminal({
				sessionId: params.sessionId,
				command: params.command,
				args: [...(params.args ?? [])],
				env,
				...(cwd !== undefined ? { cwd } : {}),
				...(outputByteLimit !== undefined ? { outputByteLimit } : {}),
			});
			return { terminalId };
		}),
	);

	app.onRequest(
		CLIENT_METHODS.terminal_output,
		serving(async (params) => {
			const output = await delegates.terminalOutput(params.sessionId, params.terminalId);
			return {
				output: output.output,
				truncated: output.truncated,
				...(output.exit !== undefined ? { exitStatus: output.exit } : {}),
			};
		}),
	);

	app.onRequest(
		CLIENT_METHODS.terminal_wait_for_exit,
		serving(async (params) => {
			const exit = await delegates.waitForTerminalExit(params.sessionId, params.terminalId);
			return { exitCode: exit.exitCode, signal: exit.signal };
		}),
	);

	app.onRequest(
		CLIENT_METHODS.terminal_kill,
		serving(async (params) => {
			await delegates.killTerminal(params.sessionId, params.terminalId);
			return {};
		}),
	);

	app.onRequest(
		CLIENT_METHODS.terminal_release,
		serving(async (params) => {
			await delegates.releaseTerminal(params.sessionId, params.terminalId);
			return {};
		}),
	);

	app.onRequest<ConnectMcpRequest, ConnectMcpResponse>(
		CLIENT_METHODS.mcp_connect,
		parseConnectMcp,
		serving((params) => mcp.connect(params)),
	);
	app.onRequest<MessageMcpRequest, MessageMcpResponse>(
		CLIENT_METHODS.mcp_message,
		parseMessageMcp,
		serving((params) => mcp.message(params)),
	);
	app.onNotification<MessageMcpRequest>(
		CLIENT_METHODS.mcp_message,
		parseMessageMcp,
		({ params }) => {
			mcp.notify(params);
		},
	);
	app.onRequest<DisconnectMcpRequest, DisconnectMcpResponse>(
		CLIENT_METHODS.mcp_disconnect,
		parseDisconnectMcp,
		serving(async (params) => mcp.disconnect(params)),
	);

	return app;
}
