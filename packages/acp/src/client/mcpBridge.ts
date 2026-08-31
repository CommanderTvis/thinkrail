import type {
	ConnectMcpRequest,
	ConnectMcpResponse,
	DisconnectMcpRequest,
	DisconnectMcpResponse,
	MessageMcpRequest,
	MessageMcpResponse,
} from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import type { AcpClientDelegates, AcpClientRuntime, McpEndpoint } from "./types";

function asObject(value: unknown, what: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw RequestError.invalidParams(undefined, `${what} must be an object`);
	}
	return value as Record<string, unknown>;
}

function asId(params: Record<string, unknown>, key: string): string {
	const value = params[key];
	if (typeof value !== "string" || value.length === 0) {
		throw RequestError.invalidParams(undefined, `'${key}' must be a non-empty string`);
	}
	return value;
}

export function parseConnectMcp(params: unknown): ConnectMcpRequest {
	return { serverId: asId(asObject(params, "params"), "serverId") };
}

export function parseMessageMcp(params: unknown): MessageMcpRequest {
	const raw = asObject(params, "params");
	const connectionId = asId(raw, "connectionId");
	const method = asId(raw, "method");
	const inner = raw.params;
	if (inner === undefined || inner === null) return { connectionId, method };
	return { connectionId, method, params: asObject(inner, "'params.params'") };
}

export function parseDisconnectMcp(params: unknown): DisconnectMcpRequest {
	return { connectionId: asId(asObject(params, "params"), "connectionId") };
}

export class McpAcpBridge {
	readonly #delegates: AcpClientDelegates;
	readonly #runtime: AcpClientRuntime;
	readonly #endpoints = new Map<string, McpEndpoint>();

	constructor(delegates: AcpClientDelegates, runtime: AcpClientRuntime) {
		this.#delegates = delegates;
		this.#runtime = runtime;
		runtime.signal.addEventListener(
			"abort",
			() => {
				for (const connectionId of [...this.#endpoints.keys()]) this.#release(connectionId);
			},
			{ once: true },
		);
	}

	async connect(request: ConnectMcpRequest): Promise<ConnectMcpResponse> {
		const endpoint = await this.#delegates.openMcpEndpoint(request.serverId);
		const connectionId = this.#runtime.nextId();
		this.#endpoints.set(connectionId, endpoint);
		return { connectionId };
	}

	async message(request: MessageMcpRequest): Promise<MessageMcpResponse> {
		const result = await this.#require(request.connectionId).request(
			request.method,
			request.params ?? undefined,
		);
		return result === undefined ? {} : result;
	}

	notify(notification: MessageMcpRequest): void {
		const endpoint = this.#endpoints.get(notification.connectionId);
		if (endpoint === undefined) return;
		endpoint.notify(notification.method, notification.params ?? undefined);
	}

	disconnect(request: DisconnectMcpRequest): DisconnectMcpResponse {
		this.#release(request.connectionId);
		return {};
	}

	#require(connectionId: string): McpEndpoint {
		const endpoint = this.#endpoints.get(connectionId);
		if (endpoint === undefined) {
			throw RequestError.invalidParams(undefined, `unknown MCP connection '${connectionId}'`);
		}
		return endpoint;
	}

	#release(connectionId: string): void {
		const endpoint = this.#endpoints.get(connectionId);
		if (endpoint === undefined) return;
		this.#endpoints.delete(connectionId);
		endpoint.close();
	}
}
