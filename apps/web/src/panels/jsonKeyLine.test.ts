import { expect, test } from "bun:test";
import { jsonKeyLine } from "./jsonKeyLine";

const mcp = `{
  "mcpServers": {
    "IntelliJ": {
      "type": "sse",
      "url": "http://127.0.0.1:64342/sse",
      "headers": {}
    },
    "git": {
      "command": "uvx",
      "args": [
        "mcp-server-git"
      ]
    },
    "gitlab": { "type": "http" }
  }
}`;

test("nested key", () => expect(jsonKeyLine(mcp, ["mcpServers", "git"])).toBe(8));
test("first key", () => expect(jsonKeyLine(mcp, ["mcpServers", "IntelliJ"])).toBe(3));
test("after array", () => expect(jsonKeyLine(mcp, ["mcpServers", "gitlab"])).toBe(14));
test("container itself", () => expect(jsonKeyLine(mcp, ["mcpServers"])).toBe(2));
test("absent", () => expect(jsonKeyLine(mcp, ["mcpServers", "nope"])).toBe(null));
test("deep leaf", () => expect(jsonKeyLine(mcp, ["mcpServers", "IntelliJ", "url"])).toBe(5));
test("empty path", () => expect(jsonKeyLine(mcp, [])).toBe(null));
test("not json", () => expect(jsonKeyLine("# hello", ["a"])).toBe(null));
test("truncated declines rather than guessing", () =>
	expect(jsonKeyLine('{"a": {"b"', ["a", "b"])).toBe(null));
test("escaped key does not desync", () => {
	const t = `{\n  "a\\"b": 1,\n  "c": 2\n}`;
	expect(jsonKeyLine(t, ["c"])).toBe(3);
});
test("brace inside string does not desync", () => {
	const t = `{\n  "a": "}{",\n  "c": 2\n}`;
	expect(jsonKeyLine(t, ["c"])).toBe(3);
});
test("array of objects skipped wholesale", () => {
	const t = `{\n  "deny": [\n    {"x": 1}\n  ],\n  "c": 2\n}`;
	expect(jsonKeyLine(t, ["c"])).toBe(5);
});
