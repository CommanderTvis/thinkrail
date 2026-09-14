import { describe, expect, test } from "bun:test";
import type { BlueprintState } from "../contracts";
import { blueprintAuthors } from "./store";

const terminalHost = { kind: "terminal" as const, key: "t1" };
const chatHost = { kind: "chat" as const, key: "s1" };

function blueprint(author: BlueprintState["author"]): BlueprintState {
	return {
		workspaceId: "w1",
		source: { kind: "idea", brief: "" },
		brief: "",
		agentId: "claude",
		author,
		phase: "awaiting",
		doc: { blocks: [], frontmatter: "" },
		changes: [],
		pendingEdits: [],
		lines: {},
	};
}

describe("blueprintAuthors", () => {
	test("is available to the terminal that authors it, not another terminal", () => {
		const state = blueprint({ kind: "terminal", tabKey: "t1" });
		expect(blueprintAuthors(state, terminalHost)).toBe(true);
		expect(blueprintAuthors(state, { ...terminalHost, key: "t2" })).toBe(false);
	});

	test("is available to the chat that authors it, not a terminal", () => {
		const state = blueprint({ kind: "chat", sessionId: "s1" });
		expect(blueprintAuthors(state, chatHost)).toBe(true);
		expect(blueprintAuthors(state, terminalHost)).toBe(false);
	});

	test("is unavailable with no blueprint at all", () => {
		expect(blueprintAuthors(undefined, terminalHost)).toBe(false);
		expect(blueprintAuthors(null, terminalHost)).toBe(false);
	});
});
