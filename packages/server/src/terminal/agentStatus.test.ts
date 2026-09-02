import { afterEach, describe, expect, test } from "bun:test";
import {
	agentMcpUrl,
	agentStatusUrl,
	agentTokenOwner,
	forgetAgentStatusTokens,
	readAgentStatusRequest,
	resetAgentStatusTokens,
	setAgentStatusEndpoint,
} from "./agentStatus";

afterEach(() => {
	resetAgentStatusTokens();
	setAgentStatusEndpoint(null);
});

function pathOf(url: string): string {
	return new URL(url).pathname;
}

describe("agent status addresses", () => {
	test("a tab reports at its own address, and keeps it across reattach", () => {
		setAgentStatusEndpoint("http://127.0.0.1:4321");
		const first = agentStatusUrl("w1", "t1");
		expect(first).toBe(agentStatusUrl("w1", "t1"));
		expect(first).not.toBe(agentStatusUrl("w1", "t2"));
		expect(first?.startsWith("http://127.0.0.1:4321/agent-status/")).toBe(true);
	});

	test("the MCP address carries the same token as the status address, on its own route", () => {
		setAgentStatusEndpoint("http://127.0.0.1:4321");
		const status = agentStatusUrl("w1", "t1");
		const mcp = agentMcpUrl("w1", "t1");
		expect(mcp?.startsWith("http://127.0.0.1:4321/mcp/")).toBe(true);
		const token = mcp?.slice("http://127.0.0.1:4321/mcp/".length) ?? "";
		expect(status?.endsWith(token)).toBe(true);
		expect(agentTokenOwner(token)).toEqual({ workspaceId: "w1", tabKey: "t1" });
		forgetAgentStatusTokens("w1", "t1");
		expect(agentTokenOwner(token)).toBeNull();
	});

	test("no endpoint yet means no address, so a terminal is simply told nothing", () => {
		expect(agentStatusUrl("w1", "t1")).toBeNull();
	});

	test("a closed tab's token stops being anybody's", () => {
		setAgentStatusEndpoint("http://127.0.0.1:4321");
		const url = agentStatusUrl("w1", "t1") as string;
		forgetAgentStatusTokens("w1", "t1");
		expect(readAgentStatusRequest(pathOf(url), { event: "stop" })).toBe("unknown-token");
	});

	test("closing a workspace forgets every tab of it, and no other", () => {
		setAgentStatusEndpoint("http://127.0.0.1:4321");
		const mine = agentStatusUrl("w1", "t1") as string;
		const other = agentStatusUrl("w2", "t1") as string;
		forgetAgentStatusTokens("w1");
		expect(readAgentStatusRequest(pathOf(mine), { event: "stop" })).toBe("unknown-token");
		expect(readAgentStatusRequest(pathOf(other), { event: "stop" })).toMatchObject({
			workspaceId: "w2",
			tabKey: "t1",
		});
	});
});

describe("reading a report", () => {
	test("the token says which tab it came from — the report never claims one", () => {
		setAgentStatusEndpoint("http://127.0.0.1:4321");
		const url = agentStatusUrl("w1", "t1") as string;
		expect(
			readAgentStatusRequest(pathOf(url), {
				event: "prompt_submit",
				workspaceId: "somebody-else",
				model: "claude-opus-5",
			}),
		).toMatchObject({
			workspaceId: "w1",
			tabKey: "t1",
			status: "running",
			report: { model: "claude-opus-5" },
		});
	});

	test("a model switch is delivered with no status: it says what runs, not what is happening", () => {
		setAgentStatusEndpoint("http://127.0.0.1:4321");
		const url = agentStatusUrl("w1", "t1") as string;
		expect(
			readAgentStatusRequest(pathOf(url), { event: "model_switch", model: "claude-opus-5" }),
		).toMatchObject({
			workspaceId: "w1",
			tabKey: "t1",
			status: null,
			report: { model: "claude-opus-5" },
		});
	});

	test("an unknown token, an unreadable body, and an event we do not know are each refused", () => {
		setAgentStatusEndpoint("http://127.0.0.1:4321");
		const url = agentStatusUrl("w1", "t1") as string;
		expect(readAgentStatusRequest("/agent-status/nobody", { event: "stop" })).toBe("unknown-token");
		expect(readAgentStatusRequest(pathOf(url), "not an object")).toBe("unreadable");
		// A newer plugin's event must not move a badge by accident.
		expect(readAgentStatusRequest(pathOf(url), { event: "invented_later" })).toBe("unreadable");
	});

	test("another path is not ours at all", () => {
		expect(readAgentStatusRequest("/health", { event: "stop" })).toBeNull();
	});
});
