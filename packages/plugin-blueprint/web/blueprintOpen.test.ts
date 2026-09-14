import { beforeEach, expect, test } from "bun:test";
import type { AgentLauncher, HostProjection, PluginWebContext } from "@thinkrail/plugin-api/web";
import type { BlueprintState, blueprintContract } from "../contracts";
import { createBlueprintOpener } from "./blueprintOpen";
import { useBlueprintStore } from "./store";

type Ctx = PluginWebContext<typeof blueprintContract>;

function blueprintState(author: BlueprintState["author"]): BlueprintState {
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

function fakeCtx(options: {
	terminals?: HostProjection["terminals"];
	launchers?: AgentLauncher[];
}): { ctx: Ctx; openedTerminals: { workspaceId: string; command?: string; tabKey?: string }[] } {
	const openedTerminals: { workspaceId: string; command?: string; tabKey?: string }[] = [];
	const ctx = {
		host: () => ({ terminals: options.terminals ?? {} }) as HostProjection,
		launchers: () => options.launchers ?? [],
		openTerminal: async (workspaceId: string, opts?: { command?: string; tabKey?: string }) => {
			openedTerminals.push({ workspaceId, ...opts });
			return { tabKey: opts?.tabKey ?? "new" };
		},
		focusCompanion: () => {},
		editors: { open: async () => null },
	} as unknown as Ctx;
	return { ctx, openedTerminals };
}

beforeEach(() => {
	useBlueprintStore.setState({ byWorkspace: {} });
});

test("restoreAuthor resumes a closed terminal author with the claude launcher's resume command", async () => {
	useBlueprintStore
		.getState()
		.setState(
			"w1",
			blueprintState({ kind: "terminal", tabKey: "blueprint-author", agentSessionId: "sess-1" }),
		);
	const claudeLauncher: AgentLauncher = {
		id: "claude",
		label: "Claude Code",
		icon: () => null,
		terminalCommand: ({ resume }) =>
			resume
				? resume.sessionId
					? `claude --resume ${resume.sessionId}`
					: "claude --continue"
				: "claude",
		useAvailable: () => ({ available: true }),
	};
	const { ctx, openedTerminals } = fakeCtx({ terminals: {}, launchers: [claudeLauncher] });
	const { openBlueprintPair } = createBlueprintOpener(ctx);

	await openBlueprintPair("w1");

	expect(openedTerminals).toEqual([
		{ workspaceId: "w1", command: "claude --resume sess-1", tabKey: "blueprint-author" },
	]);
});

test("restoreAuthor falls back to --continue when no session id was ever recorded", async () => {
	useBlueprintStore
		.getState()
		.setState("w1", blueprintState({ kind: "terminal", tabKey: "blueprint-author" }));
	const claudeLauncher: AgentLauncher = {
		id: "claude",
		label: "Claude Code",
		icon: () => null,
		terminalCommand: ({ resume }) =>
			resume
				? resume.sessionId
					? `claude --resume ${resume.sessionId}`
					: "claude --continue"
				: "claude",
		useAvailable: () => ({ available: true }),
	};
	const { ctx, openedTerminals } = fakeCtx({ terminals: {}, launchers: [claudeLauncher] });
	const { openBlueprintPair } = createBlueprintOpener(ctx);

	await openBlueprintPair("w1");

	expect(openedTerminals).toEqual([
		{ workspaceId: "w1", command: "claude --continue", tabKey: "blueprint-author" },
	]);
});

test("an already-open terminal author is focused, not recreated", async () => {
	useBlueprintStore
		.getState()
		.setState("w1", blueprintState({ kind: "terminal", tabKey: "blueprint-author" }));
	const { ctx, openedTerminals } = fakeCtx({
		terminals: { w1: [{ tabKey: "blueprint-author", title: "Author" }] },
	});
	const { openBlueprintPair } = createBlueprintOpener(ctx);

	await openBlueprintPair("w1");

	expect(openedTerminals).toEqual([]);
});
