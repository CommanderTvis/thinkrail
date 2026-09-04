import { afterEach, describe, expect, test } from "bun:test";
import {
	forgetTerminalTokens,
	resetTerminalTokens,
	setTerminalTokenEndpoint,
	terminalForToken,
	terminalMcpUrl,
	terminalToken,
	terminalTokenEndpoint,
} from "./terminalTokens";

afterEach(() => {
	resetTerminalTokens();
	setTerminalTokenEndpoint(null);
});

describe("terminal identity tokens", () => {
	test("a tab is minted the same token across reattach, and a different tab a different one", () => {
		const first = terminalToken({ workspaceId: "w1", tabKey: "t1" });
		expect(terminalToken({ workspaceId: "w1", tabKey: "t1" })).toBe(first);
		expect(terminalToken({ workspaceId: "w1", tabKey: "t2" })).not.toBe(first);
		expect(terminalForToken(first)).toEqual({ workspaceId: "w1", tabKey: "t1" });
	});

	test("an unminted or forgotten token resolves to nothing", () => {
		expect(terminalForToken("never-minted")).toBeNull();
		const token = terminalToken({ workspaceId: "w1", tabKey: "t1" });
		forgetTerminalTokens("w1", "t1");
		expect(terminalForToken(token)).toBeNull();
	});

	test("closing a workspace forgets every tab of it, and no other", () => {
		const mine = terminalToken({ workspaceId: "w1", tabKey: "t1" });
		const other = terminalToken({ workspaceId: "w2", tabKey: "t1" });
		forgetTerminalTokens("w1");
		expect(terminalForToken(mine)).toBeNull();
		expect(terminalForToken(other)).toEqual({ workspaceId: "w2", tabKey: "t1" });
	});

	test("the endpoint base is a plain getter/setter, absent until set", () => {
		expect(terminalTokenEndpoint()).toBeNull();
		setTerminalTokenEndpoint("http://127.0.0.1:4321");
		expect(terminalTokenEndpoint()).toBe("http://127.0.0.1:4321");
	});

	test("no endpoint yet means no MCP address, so a terminal is simply told nothing", () => {
		expect(terminalMcpUrl({ workspaceId: "w1", tabKey: "t1" })).toBeNull();
	});

	test("the MCP address carries the same token any other caller would mint for the tab", () => {
		setTerminalTokenEndpoint("http://127.0.0.1:4321");
		const token = terminalToken({ workspaceId: "w1", tabKey: "t1" });
		const mcp = terminalMcpUrl({ workspaceId: "w1", tabKey: "t1" });
		expect(mcp).toBe(`http://127.0.0.1:4321/mcp/${token}`);
	});

	test("resetTerminalTokens clears every mint, so a later request starts fresh", () => {
		const before = terminalToken({ workspaceId: "w1", tabKey: "t1" });
		resetTerminalTokens();
		const after = terminalToken({ workspaceId: "w1", tabKey: "t1" });
		expect(after).not.toBe(before);
	});
});
