import { expect, test } from "bun:test";
import { CODEX_ADDABLE_KEYS, codexDocsUrl, codexEnumValues, codexValueShape } from "./configDocs";

test("enum choices come from the reference's type column", () => {
	expect(codexEnumValues("sandbox_mode")).toEqual([
		"read-only",
		"workspace-write",
		"danger-full-access",
	]);
	expect(codexEnumValues("approval_policy")).toEqual(["on-request", "never"]);
	expect(codexEnumValues("model")).toBeUndefined();
	expect(codexEnumValues("hide_agent_reasoning")).toBeUndefined();
	expect(codexEnumValues("not_a_key")).toBeUndefined();
});

test("a key links to its reference row, a nested key to its nearest documented ancestor", () => {
	expect(codexDocsUrl("model")).toBe(
		"https://learn.chatgpt.com/docs/config-file/config-reference#:~:text=model,-string",
	);
	expect(codexDocsUrl("features.hooks")).toContain("#:~:text=features.hooks,-boolean");
	expect(codexDocsUrl("unknown_key")).toBeUndefined();
});

test("only documented, editable leaf keys can be added, each with its declared editor", () => {
	expect(CODEX_ADDABLE_KEYS).toContain("features.hooks");
	expect(CODEX_ADDABLE_KEYS).toContain("sandbox_mode");
	expect(CODEX_ADDABLE_KEYS).not.toContain("tui");
	expect(CODEX_ADDABLE_KEYS.some((key) => key.includes("<"))).toBe(false);
	expect(codexValueShape("hide_agent_reasoning")).toBe("switch");
	expect(codexValueShape("project_doc_max_bytes")).toBe("number");
	expect(codexValueShape("notify")).toBe("list");
	expect(codexValueShape("sandbox_mode")).toBeUndefined();
});
