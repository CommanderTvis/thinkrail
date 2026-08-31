import { expect, test } from "bun:test";
import type { ChatMessage, PromptContent, StopReason, UserMessage } from "@thinkrail/contracts";
import { extractFirstTurn, naiveWorkspaceName, toWorkspaceName } from "./assist";

let seq = 0;

function user(content: string | PromptContent[], hidden?: true): UserMessage {
	seq += 1;
	return {
		role: "user",
		id: `u${seq}`,
		timestamp: seq,
		content: typeof content === "string" ? [{ type: "text", text: content }] : content,
		...(hidden === undefined ? {} : { hidden }),
	};
}

function assistant(text: string): ChatMessage {
	seq += 1;
	return { role: "assistant", id: `a${seq}`, timestamp: seq, blocks: [{ type: "text", text }] };
}

function settled(stopReason: StopReason): ChatMessage {
	seq += 1;
	return {
		role: "marker",
		id: `m${seq}`,
		timestamp: seq,
		marker: { kind: "turnSettled", stopReason },
	};
}

test("toWorkspaceName normalizes model output into a safe, bounded display name, preserving casing", () => {
	expect(toWorkspaceName('"Add Login Flow"')).toBe("Add Login Flow");
	expect(toWorkspaceName("`fix: the parser!!!`")).toBe("fix the parser");
	expect(toWorkspaceName("  Refactor   Auth  ")).toBe("Refactor Auth");
	expect(toWorkspaceName("one two three four five six")).toBe("one two three four five");
	expect(toWorkspaceName("Add OAuth login")).toBe("Add OAuth login");
	expect(toWorkspaceName("!!! ??? ...")).toBeNull();
	expect(toWorkspaceName("")).toBeNull();
});

test("naiveWorkspaceName derives a bounded Title Case name straight from the first prompt", () => {
	expect(naiveWorkspaceName("Let's figure out how to better implement")).toBe(
		"Let S Figure Out How",
	);
	expect(naiveWorkspaceName("refactor the workspace naming flow please")).toBe(
		"Refactor The Workspace Naming Flow",
	);
	expect(naiveWorkspaceName("  add a login form!!! ")).toBe("Add A Login Form");
});

test("naiveWorkspaceName grows short words to the minimum but never past the maxima", () => {
	expect(naiveWorkspaceName("a b c d e f g")).toBe("A B C D E");
	expect(naiveWorkspaceName("implement authentication authorization middleware refactor")).toBe(
		"Implement Authentication Authorization",
	);
	expect(naiveWorkspaceName("add login")).toBe("Add Login");
});

test("naiveWorkspaceName returns null for a blank or unusable prompt", () => {
	expect(naiveWorkspaceName("")).toBeNull();
	expect(naiveWorkspaceName("   ")).toBeNull();
	expect(naiveWorkspaceName("!!! ??? ...")).toBeNull();
});

test("extractFirstTurn pulls the first prompt + first assistant answer from a transcript", () => {
	const turn = extractFirstTurn([
		user("add a login flow"),
		assistant("Sure, here is the plan…"),
		settled("completed"),
		user("now add tests"),
	]);
	expect(turn).toEqual({ prompt: "add a login flow", answer: "Sure, here is the plan…" });
});

test("extractFirstTurn reads multi-part user content and tolerates a missing answer", () => {
	const turn = extractFirstTurn([
		user([
			{ type: "text", text: "please " },
			{ type: "text", text: "rename things" },
		]),
	]);
	expect(turn).toEqual({ prompt: "please rename things", answer: "" });
});

test("extractFirstTurn returns null when there is no user turn yet", () => {
	expect(extractFirstTurn([])).toBeNull();
	expect(extractFirstTurn([assistant("hi")])).toBeNull();
	expect(extractFirstTurn([user("   ")])).toBeNull();
});

test("extractFirstTurn ignores a hidden user message — the host's own prompts never name a workspace", () => {
	const turn = extractFirstTurn([
		user("[nudge] wake up", true),
		assistant("ok"),
		settled("completed"),
	]);
	expect(turn).toBeNull();
});

test("extractFirstTurn skips killed turns — a retracted prompt is never naming material", () => {
	const turn = extractFirstTurn([
		user("refactor the billing engine"),
		assistant("Starting on billing…"),
		settled("cancelled"),
		user("fix the header layout"),
		assistant("Done — header fixed."),
		settled("completed"),
	]);
	expect(turn).toEqual({ prompt: "fix the header layout", answer: "Done — header fixed." });
});

test("extractFirstTurn returns null when every turn was killed", () => {
	expect(
		extractFirstTurn([
			user("do a thing"),
			assistant(""),
			settled("failed"),
			user("try again"),
			assistant(""),
			settled("cancelled"),
		]),
	).toBeNull();
});

test("extractFirstTurn judges a multi-round turn by its last settlement, not its first", () => {
	const turn = extractFirstTurn([
		user("first task"),
		assistant("let me look…"),
		settled("completed"),
		assistant(""),
		settled("cancelled"),
		user("second task"),
		assistant("on it"),
		settled("completed"),
	]);
	expect(turn).toEqual({ prompt: "second task", answer: "on it" });
});
