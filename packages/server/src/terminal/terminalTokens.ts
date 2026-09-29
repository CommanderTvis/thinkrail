import { randomUUID } from "node:crypto";
import type { TerminalRef } from "@thinkrail/plugin-api";

const owners = new Map<string, TerminalRef>();
const tokens = new Map<string, string>();
let endpointBase: string | null = null;

function ownerKey(workspaceId: string, tabKey: string): string {
	return `${workspaceId} ${tabKey}`;
}

export function setTerminalTokenEndpoint(base: string | null): void {
	endpointBase = base;
}

export function terminalTokenEndpoint(): string | null {
	return endpointBase;
}

/** Stable per tab: a reattached terminal keeps reporting under the same token it was given. */
export function terminalToken(terminal: TerminalRef): string {
	const key = ownerKey(terminal.workspaceId, terminal.tabKey);
	let token = tokens.get(key);
	if (!token) {
		token = randomUUID();
		tokens.set(key, token);
		owners.set(token, terminal);
	}
	return token;
}

export function terminalForToken(token: string): TerminalRef | null {
	return owners.get(token) ?? null;
}

export function forgetTerminalTokens(workspaceId: string, tabKey?: string): void {
	for (const [key, token] of [...tokens]) {
		const owner = owners.get(token);
		if (!owner || owner.workspaceId !== workspaceId) continue;
		if (tabKey !== undefined && owner.tabKey !== tabKey) continue;
		tokens.delete(key);
		owners.delete(token);
	}
}

export function resetTerminalTokens(): void {
	owners.clear();
	tokens.clear();
}

/** The same token, on the MCP route: one identity per terminal, two things it can say. */
export function terminalMcpUrl(terminal: TerminalRef): string | null {
	if (endpointBase === null) return null;
	return `${endpointBase}/mcp/${terminalToken(terminal)}`;
}
