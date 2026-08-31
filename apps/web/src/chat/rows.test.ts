import { describe, expect, test } from "bun:test";
import type {
	AskUserQuestionResult,
	ChatBlock,
	ChatMessage,
	CompactionReason,
	StopReason,
	ToolCallStatus,
} from "@thinkrail/contracts";
import { deriveRows, type LiveProgress, projectRows, turnDivider } from "./rows";
import { registerToolRenderer } from "./toolRegistry";

registerToolRenderer("primary-tool", () => null, { prominence: "primary" });
registerToolRenderer("bare-tool", () => null, { chrome: "bare" });

const NO_PROGRESS: LiveProgress = { retries: {}, compacting: null };

function user(id: string, timestamp = 0, hidden = false): ChatMessage {
	return {
		role: "user",
		id,
		timestamp,
		content: [{ type: "text", text: "hi" }],
		...(hidden ? { hidden: true } : {}),
	};
}

function assistant(
	id: string,
	blocks: ChatBlock[],
	opts: { streaming?: boolean; timestamp?: number } = {},
): ChatMessage {
	return {
		role: "assistant",
		id,
		timestamp: opts.timestamp ?? 0,
		blocks,
		...(opts.streaming ? {} : { endedAt: 0 }),
	};
}

function settled(
	id: string,
	timestamp: number,
	stopReason: StopReason,
	opts: { startedAt?: number; error?: string } = {},
): ChatMessage {
	return {
		role: "marker",
		id,
		timestamp,
		marker: {
			kind: "turnSettled",
			stopReason,
			...(opts.startedAt !== undefined ? { startedAt: opts.startedAt } : {}),
			...(opts.error !== undefined ? { error: opts.error } : {}),
		},
	};
}

function compaction(
	id: string,
	reason: CompactionReason,
	summary: string,
	tokensBefore?: number,
): ChatMessage {
	return {
		role: "marker",
		id,
		timestamp: 0,
		marker: {
			kind: "compaction",
			reason,
			summary,
			...(tokensBefore !== undefined ? { tokensBefore } : {}),
		},
	};
}

function notice(id: string, level: "info" | "warning" | "error", text: string): ChatMessage {
	return { role: "marker", id, timestamp: 0, marker: { kind: "notice", level, text } };
}

function questionAnswers(
	id: string,
	toolCallId: string,
	result: AskUserQuestionResult,
): ChatMessage {
	return {
		role: "marker",
		id,
		timestamp: 0,
		marker: { kind: "questionAnswers", toolCallId, result },
	};
}

const tc = (id: string, toolName = "bash", status: ToolCallStatus = "done"): ChatBlock => ({
	type: "toolCall",
	toolCallId: id,
	toolName,
	title: toolName,
	kind: "execute",
	status,
	arguments: {},
});
const think = (text: string): ChatBlock => ({ type: "thinking", text });
const text = (t: string): ChatBlock => ({ type: "text", text: t });

const kinds = (rows: ReturnType<typeof deriveRows>) => rows.map((r) => r.kind);

function messageRow(id: string, kind: "user" | "markdown"): ChatRow {
	return kind === "user"
		? { kind, id, message: { role: "user", content: id, timestamp: 0 } }
		: { kind, id, text: id };
}

describe("projectRows message order", () => {
	test("newest-first reverses both request groups and their rows while keeping a prelude separate", () => {
		const rows: ChatRow[] = [
			{ kind: "system", id: "prelude", text: "connected" },
			messageRow("u1", "user"),
			messageRow("a1", "markdown"),
			{ kind: "system", id: "s1", text: "done" },
			messageRow("u2", "user"),
			messageRow("a2", "markdown"),
			{ kind: "system", id: "s2", text: "done" },
		];

		expect(projectRows(rows, "newest-first").map((row) => row.id)).toEqual([
			"s2",
			"a2",
			"u2",
			"s1",
			"a1",
			"u1",
			"prelude",
		]);
	});

	test("oldest-first preserves canonical row order and newest-first preserves row objects", () => {
		const activity: ChatRow = { kind: "activity", id: "work", steps: [], live: false };
		const rows: ChatRow[] = [messageRow("u1", "user"), activity];
		expect(projectRows(rows, "oldest-first")).toBe(rows);
		expect(projectRows(rows, "newest-first")).toEqual([activity, rows[0]]);
		expect(projectRows(rows, "newest-first")[0]).toBe(activity);
	});
});

describe("deriveRows grouping", () => {
	test("keeps one outer activity run and nests tools under the preceding thinking block", () => {
		const messages = [
			user("u1"),
			assistant("a1", [tc("t0", "read"), think("plan"), tc("t1", "bash")]),
			assistant("a2", [tc("t2", "read"), think("revise"), tc("t3", "edit")]),
			assistant("a3", [text("the answer")]),
			settled("s1", 1_000, "completed", { startedAt: 0 }),
		];
		const rows = deriveRows(messages, false, NO_PROGRESS);
		expect(kinds(rows)).toEqual(["user", "activity", "markdown", "settled", "divider"]);
		const activity = rows[1];
		if (activity?.kind !== "activity") throw new Error("expected one activity row");
		expect(activity).toMatchObject({ id: "activity:t0", live: false });
		expect(activity.steps).toMatchObject([
			{ kind: "tool", id: "t0" },
			{
				kind: "thinking",
				id: "a1:thinking:1",
				text: "plan",
				tools: [{ id: "t1" }, { id: "t2" }],
			},
			{
				kind: "thinking",
				id: "a2:thinking:1",
				text: "revise",
				tools: [{ id: "t3" }],
			},
		]);
	});

	test("non-empty text splits the run; empty/whitespace text and empty thinking do not", () => {
		const messages = [
			user("u1"),
			assistant("a1", [
				tc("t1"),
				text("  "),
				think(""),
				tc("t2"),
				text("interim narration"),
				tc("t3"),
			]),
			settled("s1", 1_000, "completed", { startedAt: 0 }),
		];
		const rows = deriveRows(messages, false, NO_PROGRESS);
		expect(kinds(rows)).toEqual(["user", "activity", "markdown", "activity", "settled", "divider"]);
		const first = rows[1];
		const second = rows[3];
		if (first?.kind !== "activity" || second?.kind !== "activity") throw new Error("bad rows");
		expect(first.steps.map((s) => s.id)).toEqual(["t1", "t2"]);
		expect(second.steps.map((s) => s.id)).toEqual(["t3"]);
	});

	test("a primary tool escapes the fold as its own row and breaks the run (bare implies primary)", () => {
		const messages = [
			user("u1"),
			assistant("a1", [tc("t1"), tc("v1", "primary-tool"), tc("t2"), tc("q1", "bare-tool")]),
			settled("s1", 1_000, "completed", { startedAt: 0 }),
		];
		const rows = deriveRows(messages, false, NO_PROGRESS);
		expect(kinds(rows)).toEqual([
			"user",
			"activity",
			"tool",
			"activity",
			"tool",
			"settled",
			"divider",
		]);
		const primary = rows[2];
		if (primary?.kind !== "tool") throw new Error("expected tool row");
		expect(primary.block.toolCallId).toBe("v1");
		expect(rows[4]?.id).toBe("q1");
	});

	test("a hidden user message (host control traffic) is recorded but never rendered as its own row", () => {
		const rows = deriveRows([user("u1", 0, true), user("u2")], false, NO_PROGRESS);
		expect(kinds(rows)).toEqual(["user"]);
		expect(rows[0]?.id).toBe("u2");
	});

	test("a questionAnswers marker is consumed by the ask card, never its own row", () => {
		const messages = [
			user("u1"),
			assistant("a1", [tc("t1", "ask_user_question")]),
			questionAnswers("qa1", "t1", { answers: [], cancelled: false }),
		];
		expect(kinds(deriveRows(messages, true, NO_PROGRESS))).toEqual(["user", "activity"]);
	});

	test("notices and user messages break runs and map 1:1; live retries render as trailing rows", () => {
		const messages = [
			user("u1"),
			assistant("a1", [tc("t1")]),
			notice("n1", "error", "boom"),
			assistant("a2", [tc("t2")]),
		];
		const rows = deriveRows(messages, true, {
			retries: { summarization: { attempt: 1, maxAttempts: 3, delayMs: 500 } },
			compacting: null,
		});
		expect(kinds(rows)).toEqual(["user", "activity", "notice", "activity", "retry"]);
		expect(rows[2]).toMatchObject({ kind: "notice", level: "error", text: "boom" });
		expect(rows[4]).toMatchObject({ kind: "retry", scope: "summarization", attempt: 1 });
	});

	test("a tool step carries its block's own status straight through (abandoned reads apart from an ordinary failure)", () => {
		const messages = [
			user("u1"),
			assistant("a1", [tc("t1", "bash", "done"), tc("t2", "bash", "abandoned")]),
		];
		const rows = deriveRows(messages, false, NO_PROGRESS);
		const activity = rows[1];
		if (activity?.kind !== "activity") throw new Error("expected activity row");
		const [s1, s2] = activity.steps;
		expect(s1?.kind === "tool" && s1.block.status).toBe("done");
		expect(s2?.kind === "tool" && s2.block.status).toBe("abandoned");
	});
});

describe("deriveRows compaction and retry", () => {
	test("a compaction marker maps 1:1 to its own row and breaks the activity run (never folded)", () => {
		const messages = [
			user("u1"),
			assistant("a1", [tc("t1", "bash")]),
			compaction("c1", "threshold", "earlier work summarized", 268_909),
			assistant("a2", [tc("t2", "read")]),
			settled("s1", 1_000, "completed", { startedAt: 0 }),
		];
		const rows = deriveRows(messages, false, NO_PROGRESS);
		expect(kinds(rows)).toEqual([
			"user",
			"activity",
			"compaction",
			"activity",
			"settled",
			"divider",
		]);
		expect(rows[2]).toMatchObject({
			kind: "compaction",
			id: "c1",
			reason: "threshold",
			summary: "earlier work summarized",
			tokensBefore: 268_909,
		});
	});

	test("a live compaction-in-progress renders as a trailing row regardless of isStreaming", () => {
		const rows = deriveRows([user("u1")], false, { retries: {}, compacting: "overflow" });
		expect(rows.at(-1)).toEqual({ kind: "compacting", id: "compacting", reason: "overflow" });
	});

	test("retry rows are trailing and keyed by scope — both flows can render at once", () => {
		const rows = deriveRows([user("u1")], true, {
			retries: {
				turn: { attempt: 1, maxAttempts: 3, delayMs: 500 },
				summarization: { attempt: 2, maxAttempts: 4, delayMs: 800 },
			},
			compacting: null,
		});
		expect(kinds(rows)).toEqual(["user", "retry", "retry"]);
		expect(rows[1]).toMatchObject({ kind: "retry", scope: "turn", attempt: 1 });
		expect(rows[2]).toMatchObject({ kind: "retry", scope: "summarization", attempt: 2 });
	});
});

describe("deriveRows live trailing run", () => {
	test("the one trailing outer activity run is live while its nested groups stay structural", () => {
		const messages = [
			user("u1"),
			assistant("a1", [think("first"), tc("t1"), think("second"), tc("t2")], {
				streaming: true,
			}),
		];
		const rows = deriveRows(messages, true, NO_PROGRESS);
		expect(kinds(rows)).toEqual(["user", "activity"]);
		const activity = rows[1];
		if (activity?.kind !== "activity") throw new Error("expected activity row");
		expect(activity.live).toBe(true);
		expect(activity.steps.map((step) => step.kind)).toEqual(["thinking", "thinking"]);
		expect(
			activity.steps.every(
				(step) => step.kind === "thinking" && step.tools.every((tool) => tool.streaming),
			),
		).toBe(true);
	});

	test("the run stops being live the moment answer text starts (auto-collapse trigger)", () => {
		const messages = [
			user("u1"),
			assistant("a1", [think("hmm"), tc("t1"), text("The answer is")], { streaming: true }),
		];
		const rows = deriveRows(messages, true, NO_PROGRESS);
		expect(kinds(rows)).toEqual(["user", "activity", "markdown"]);
		expect(rows[1]?.kind === "activity" && rows[1].live).toBe(false);
	});

	test("a finished transcript has no live run even if its trailing tool call was abandoned", () => {
		const messages = [user("u1"), assistant("a1", [tc("t1", "bash", "abandoned")])];
		const rows = deriveRows(messages, false, NO_PROGRESS);
		const activity = rows[1];
		if (activity?.kind !== "activity") throw new Error("expected activity row");
		expect(activity.live).toBe(false);
	});

	test("a run broken by a mid-round user boundary is never live even while streaming", () => {
		const messages = [
			user("u1", 0),
			assistant("a1", [tc("t1")]),
			settled("s1", 1_000, "completed", { startedAt: 0 }),
			user("u2", 1_000),
			assistant("a2", [tc("t2")], { streaming: true }),
		];
		const rows = deriveRows(messages, true, NO_PROGRESS);
		expect(kinds(rows)).toEqual(["user", "activity", "settled", "divider", "user", "activity"]);
		expect(rows[1]?.kind === "activity" && rows[1].live).toBe(false);
		expect(rows[5]?.kind === "activity" && rows[5].live).toBe(true);
	});

	test("row and step ids are stable across streaming snapshots (fold-state keys)", () => {
		const early = deriveRows(
			[user("u1"), assistant("a1", [think("h"), tc("t1")], { streaming: true })],
			true,
			NO_PROGRESS,
		);
		const late = deriveRows(
			[
				user("u1"),
				assistant("a1", [think("hmm more"), tc("t1"), tc("t2")], { streaming: false }),
				assistant("a2", [tc("t3")], { streaming: true }),
			],
			true,
			NO_PROGRESS,
		);
		const a1 = early[1];
		const a2 = late[1];
		if (a1?.kind !== "activity" || a2?.kind !== "activity") throw new Error("bad rows");
		expect(a2.id).toBe(a1.id);
		const firstEarly = a1.steps[0];
		const firstLate = a2.steps[0];
		if (firstEarly?.kind !== "thinking" || firstLate?.kind !== "thinking")
			throw new Error("expected nested thinking");
		expect(firstLate.id).toBe(firstEarly.id);
		expect(firstLate.tools.slice(0, 1).map((step) => step.id)).toEqual(
			firstEarly.tools.map((step) => step.id),
		);
	});
});

describe("deriveRows dividers", () => {
	test("a divider row closes the round at its settled marker (not at the next user message)", () => {
		const messages = [
			user("u1", 1_000),
			assistant("a1", [tc("t1", "write")]),
			settled("s1", 3_000, "completed", { startedAt: 1_000 }),
		];
		const rows = deriveRows(messages, false, NO_PROGRESS);
		expect(kinds(rows)).toEqual(["user", "activity", "settled", "divider"]);
		const divider = rows[3];
		if (divider?.kind !== "divider") throw new Error("expected divider row");
		expect(divider.data.toolCount).toBe(1);
		expect(divider.id).toBe("s1:divider");
	});

	test("no divider while the round still streams", () => {
		const rows = deriveRows(
			[user("u1"), assistant("a1", [text("answering…")], { streaming: true })],
			true,
			NO_PROGRESS,
		);
		expect(kinds(rows)).toEqual(["user", "markdown"]);
	});
});

function assistantWithPaths(
	id: string,
	toolCalls: Array<{ name: string; path?: string }>,
	timestamp = 0,
): ChatMessage {
	return assistant(
		id,
		toolCalls.map((t, i) => ({
			type: "toolCall" as const,
			toolCallId: `${id}-${i}`,
			toolName: t.name,
			title: t.name,
			kind: "execute" as const,
			status: "done" as const,
			arguments: t.path ? { path: t.path } : {},
		})),
		{ timestamp },
	);
}

test("turnDivider is null when the given index is not a settled-turn marker", () => {
	expect(turnDivider([user("u1")], 0)).toBeNull();
	expect(turnDivider([], 0)).toBeNull();
});

test("turnDivider counts tools, collects only edit/write files, and measures elapsed from the marker's own startedAt", () => {
	const messages = [
		user("u1", 1_000),
		assistantWithPaths("a1", [
			{ name: "bash" },
			{ name: "write", path: "a.ts" },
			{ name: "edit", path: "a.ts" },
			{ name: "read", path: "b.ts" },
		]),
		settled("s1", 73_000, "completed", { startedAt: 1_000 }),
	];
	const d = turnDivider(messages, 2);
	expect(d?.toolCount).toBe(4);
	expect(d?.changedFiles).toEqual(["a.ts"]);
	expect(d?.elapsedMs).toBe(72_000);
});

test("turnDivider spans multiple assistant messages in the round and dedupes files", () => {
	const messages = [
		user("u1", 0),
		assistantWithPaths("a1", [{ name: "write", path: "x.ts" }]),
		assistantWithPaths("a2", [
			{ name: "edit", path: "x.ts" },
			{ name: "write", path: "y.ts" },
		]),
		settled("s1", 5_000, "completed", { startedAt: 0 }),
	];
	const d = turnDivider(messages, 3);
	expect(d?.toolCount).toBe(3);
	expect(d?.changedFiles).toEqual(["x.ts", "y.ts"]);
	expect(d?.elapsedMs).toBe(5_000);
});

test("turnDivider reads a null elapsed when the settled marker carries no startedAt", () => {
	const messages = [
		user("u1", 1_000),
		assistantWithPaths("a1", [{ name: "write", path: "x.ts" }], 6_000),
		settled("s1", 6_000, "completed"),
	];
	const d = turnDivider(messages, 2);
	expect(d?.toolCount).toBe(1);
	expect(d?.changedFiles).toEqual(["x.ts"]);
	expect(d?.elapsedMs).toBeNull();
});

test("turnDivider reports no changed files / zero tools for a plain Q&A round", () => {
	const messages = [
		user("u1", 0),
		assistantWithPaths("a1", [], 2_000),
		settled("s1", 2_000, "completed", { startedAt: 0 }),
	];
	const d = turnDivider(messages, 2);
	expect(d?.toolCount).toBe(0);
	expect(d?.specs).toEqual([]);
	expect(d?.changedFiles).toEqual([]);
	expect(d?.elapsedMs).toBe(2_000);
});

test("turnDivider splits specs from code changes via isSpec, each path on exactly one side", () => {
	const messages = [
		user("u1", 0),
		assistantWithPaths("a1", [
			{ name: "write", path: "packages/pi-todos/SPEC.md" },
			{ name: "edit", path: "packages/pi-todos/core/store.ts" },
		]),
		settled("s1", 5_000, "completed", { startedAt: 0 }),
	];
	const d = turnDivider(messages, 2, (p) => p.endsWith("SPEC.md"));
	expect(d?.specs).toEqual(["packages/pi-todos/SPEC.md"]);
	expect(d?.changedFiles).toEqual(["packages/pi-todos/core/store.ts"]);
});

test("turnDivider counts a gitignored scratch spec as a spec, not as a (never-visible) change", () => {
	const path = ".thinkrail/context/TASK-todo-linear-groups.md";
	const messages = [
		user("u1", 0),
		assistantWithPaths("a1", [
			{ name: "spec_create", path },
			{ name: "write", path },
			{ name: "edit", path },
		]),
		settled("s1", 5_000, "completed", { startedAt: 0 }),
	];
	const d = turnDivider(messages, 2, () => false);
	expect(d?.toolCount).toBe(3);
	expect(d?.specs).toEqual([path]);
	expect(d?.changedFiles).toEqual([]);
});

test("turnDivider lets the spec side win a tie — a path reached by both routes is never double-counted", () => {
	const path = "docs/SPEC.md";
	const messages = [
		user("u1", 0),
		assistantWithPaths("a1", [
			{ name: "edit", path },
			{ name: "spec_create", path },
		]),
		settled("s1", 5_000, "completed", { startedAt: 0 }),
	];
	const d = turnDivider(messages, 2);
	expect(d?.specs).toEqual([path]);
	expect(d?.changedFiles).toEqual([]);
});

test("turnDivider treats every written file as a change when no classifier is supplied", () => {
	const messages = [
		user("u1", 0),
		assistantWithPaths("a1", [{ name: "write", path: "SPEC.md" }]),
		settled("s1", 5_000, "completed", { startedAt: 0 }),
	];
	const d = turnDivider(messages, 2);
	expect(d?.specs).toEqual([]);
	expect(d?.changedFiles).toEqual(["SPEC.md"]);
});
