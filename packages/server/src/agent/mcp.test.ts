import { expect, test } from "bun:test";
import type { ChatCapabilities, McpToolDelivery } from "@thinkrail/contracts";
import { mcpOffer } from "./mcp";
import type { McpHttpEndpoint, McpToolServer } from "./ports";
import { bundledAgent, dormantCapabilities } from "./resolve";

const AGENT = bundledAgent({ command: "thinkrail", args: ["acp-pi"] }).descriptor;

function capabilities(mcpTools: McpToolDelivery): ChatCapabilities {
	return { ...dormantCapabilities(AGENT), mcpTools };
}

function server(http: McpHttpEndpoint | null): McpToolServer {
	return {
		name: "ThinkRail",
		serverId: "thinkrail",
		httpEndpoint: () => http,
		open: async () => {
			throw new Error("not exercised");
		},
	};
}

test("an agent that carries MCP over ACP is offered the connection, not a port", () => {
	expect(mcpOffer(capabilities("acp"), server({ url: "http://127.0.0.1:1/mcp" }))).toEqual({
		kind: "acp",
		name: "ThinkRail",
		serverId: "thinkrail",
	});
});

test("an agent that cannot falls back to the host's own HTTP endpoint", () => {
	const offer = mcpOffer(
		capabilities("http"),
		server({ url: "http://127.0.0.1:24242/mcp", headers: [{ name: "x-token", value: "t" }] }),
	);
	expect(offer).toEqual({
		kind: "http",
		name: "ThinkRail",
		url: "http://127.0.0.1:24242/mcp",
		headers: [{ name: "x-token", value: "t" }],
	});
});

test("nothing is offered when the tools are native, unreachable or unserved", () => {
	expect(mcpOffer(capabilities("native"), server({ url: "http://x/mcp" }))).toBeUndefined();
	expect(mcpOffer(capabilities("none"), server({ url: "http://x/mcp" }))).toBeUndefined();
	expect(mcpOffer(capabilities("http"), server(null))).toBeUndefined();
	expect(mcpOffer(capabilities("acp"), null)).toBeUndefined();
});
