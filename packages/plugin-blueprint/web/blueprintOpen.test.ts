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
}): {
	ctx: Ctx;
	openedTerminals: { workspaceId: string; command?: string; tabKey?: string }[];
	openedChats: { workspaceId: string; prompt?: string; sessionId?: string }[];
} {
	const openedTerminals: { workspaceId: string; command?: string; tabKey?: string }[] = [];
	const openedChats: { workspaceId: string; prompt?: string; sessionId?: string }[] = [];
	const ctx = {
		host: () => ({ terminals: options.terminals ?? {} }) as HostProjection,
		launchers: () => options.launchers ?? [],
		openTerminal: async (workspaceId: string, opts?: { command?: string; tabKey?: string }) => {
			openedTerminals.push({ workspaceId, ...opts });
			return { tabKey: opts?.tabKey ?? "new" };
		},
		openChat: async (workspaceId: string, opts?: { prompt?: string; sessionId?: string }) => {
			openedChats.push({ workspaceId, ...opts });
			return { sessionId: opts?.sessionId ?? "chat-1" };
		},
		request: async (method: string) => {
			if (method === "open")
				return { state: blueprintState(null), opening: "opening", systemPrompt: "appendix" };
			return { ok: true };
		},
		focusCompanion: () => {},
		editors: { open: async () => null },
	} as unknown as Ctx;
	return { ctx, openedTerminals, openedChats };
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

test("a closed terminal without a recorded session falls back to a chat", async () => {
	useBlueprintStore
		.getState()
		.setState("w1", blueprintState({ kind: "terminal", tabKey: "blueprint-author" }));
	const claudeLauncher: AgentLauncher = {
		id: "claude",
		label: "Claude Code",
		icon: () => null,
		terminalCommand: () => "claude --continue",
		useAvailable: () => ({ available: true }),
	};
	const { ctx, openedChats, openedTerminals } = fakeCtx({
		terminals: {},
		launchers: [claudeLauncher],
	});
	const { openBlueprintPair } = createBlueprintOpener(ctx);

	await openBlueprintPair("w1");

	expect(openedTerminals).toEqual([]);
	expect(openedChats).toEqual([{ workspaceId: "w1", prompt: "opening" }]);
});

test("a catalogued terminal author is attached because its layout tab may be closed", async () => {
	useBlueprintStore
		.getState()
		.setState("w1", blueprintState({ kind: "terminal", tabKey: "blueprint-author" }));
	const { ctx, openedTerminals } = fakeCtx({
		terminals: { w1: [{ tabKey: "blueprint-author", title: "Author" }] },
	});
	const { openBlueprintPair } = createBlueprintOpener(ctx);

	await openBlueprintPair("w1");

	expect(openedTerminals).toEqual([{ workspaceId: "w1", tabKey: "blueprint-author" }]);
});

test("openBlueprintPair starts a chat author when no author exists and no claude launcher", async () => {
	useBlueprintStore.getState().setState("w1", blueprintState(null));
	const { ctx, openedChats } = fakeCtx({ terminals: {}, launchers: [] });
	const { openBlueprintPair } = createBlueprintOpener(ctx);

	await openBlueprintPair("w1");

	expect(openedChats).toHaveLength(1);
	expect(openedChats[0]?.workspaceId).toBe("w1");
});

test("openBlueprintPair starts a bundled chat even when the Claude launcher is available", async () => {
	useBlueprintStore.getState().setState("w1", blueprintState(null));
	const claudeLauncher: AgentLauncher = {
		id: "claude",
		label: "Claude Code",
		icon: () => null,
		terminalCommand: () => "claude",
		useAvailable: () => ({ available: true }),
	};
	const { ctx, openedChats, openedTerminals } = fakeCtx({
		terminals: {},
		launchers: [claudeLauncher],
	});
	const { openBlueprintPair } = createBlueprintOpener(ctx);

	await openBlueprintPair("w1");

	expect(openedTerminals).toEqual([]);
	expect(openedChats).toEqual([{ workspaceId: "w1", prompt: "opening" }]);
});

test("openBlueprintPair restores an existing chat author when sessionId is recorded", async () => {
	useBlueprintStore
		.getState()
		.setState("w1", blueprintState({ kind: "chat", sessionId: "chat-old" }));
	const { ctx, openedChats } = fakeCtx({ terminals: {}, launchers: [] });
	const { openBlueprintPair } = createBlueprintOpener(ctx);

	await openBlueprintPair("w1");

	expect(openedChats).toHaveLength(1);
	expect(openedChats[0]?.sessionId).toBe("chat-old");
});
