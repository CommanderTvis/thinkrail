import { randomUUID } from "node:crypto";
import type {
	TerminalDataPush,
	TerminalDetachedPush,
	TerminalExitPush,
	TerminalTabInfo,
} from "@thinkrail/contracts";
import { TERMINAL_REPLAY_KB, WS_CHANNELS } from "@thinkrail/contracts";
import { type IPty, spawn } from "bun-pty";
import { ideBridgePort, SSE_PORT_ENV } from "../ideBridge";
import {
	loadConfig,
	loadTerminalSessions,
	loadWorkspaces,
	type PersistedTerminalSessions,
	saveTerminalSessions,
} from "../persistence";
import { agentSessionExists, resumeCommand } from "./agentResume";
import { agentMcpUrl, agentStatusUrl, forgetAgentStatusTokens } from "./agentStatus";
import { type AgentWatch, createAgentWatch } from "./agentWatch";
import { createTerminalCompletionQueue } from "./completionQueue";
import { createMouseModeGuard, type MouseModeGuard } from "./mouseModeGuard";
import {
	createOutputBatcher,
	type OutputBatcher,
	type TerminalDeliveryResult,
} from "./outputBatcher";
import { createOutputRecorder, type OutputRecorder } from "./outputRecorder";
import { captureProcessCommand } from "./processTree";
import { nudgePtyRedraw, type PtyGrid, resizePtyIfChanged } from "./ptyGrid";
import { terminalShell, terminalShellArgs } from "./shellArgs";
import { hasChildProcesses } from "./shellBusy";

type PushToClient = (clientKey: string, channel: string, data: unknown) => TerminalDeliveryResult;

interface TerminalEntry {
	pty: IPty;
	workspaceId: string;
	tabKey: string;
	attachedClient: string | null;
	output: OutputBatcher;
	recorder: OutputRecorder;
	mouseModeGuard: MouseModeGuard;
	grid: PtyGrid;
	agentCommand?: string | undefined;
	agentSessionId?: string | undefined;
}

interface TabRecord {
	tabKey: string;
	title: string;
	/** The name the tab was opened with, restored when a program clears the title it set. */
	defaultTitle?: string;
}

const OUTPUT_BATCH = {
	flushMs: 8,
	maxBatchChars: 32_768,
	maxPendingChars: 1_048_576,
} as const;
const MAX_TERMINAL_TABS_PER_WORKSPACE = 256;
const MAX_TERMINAL_TAB_KEY_LENGTH = 500;
const MAX_TERMINAL_TITLE_LENGTH = 1000;

const terminals = new Map<string, TerminalEntry>();
const ptyByTab = new Map<string, string>();
const tabsByWorkspace = new Map<string, TabRecord[]>();
const pendingReplay = new Map<string, string>();
const pendingPrefill = new Map<string, string>();
/** The session an un-taken offer names, kept so a restart still has one to make. See SPEC.md. */
const carriedAgent = new Map<string, { command: string; sessionId: string }>();

const TAB_INDEX_SEP = "\u0000";

function tabIndex(workspaceId: string, tabKey: string): string {
	return `${workspaceId}${TAB_INDEX_SEP}${tabKey}`;
}

let pushToClient: PushToClient = () => "unavailable";
export function setTerminalPublisher(fn: PushToClient): void {
	pushToClient = fn;
}

let broadcastTabs: (workspaceId: string, tabs: TerminalTabInfo[]) => void = () => {};
export function setTerminalTabsPublisher(
	fn: (workspaceId: string, tabs: TerminalTabInfo[]) => void,
): void {
	broadcastTabs = fn;
}

function membershipChanged(workspaceId: string): void {
	broadcastTabs(workspaceId, listTerminals(workspaceId));
	persistTerminalSessions();
}

const agentWatch: AgentWatch = createAgentWatch({
	listTargets: () =>
		[...terminals.values()].map((entry) => ({
			workspaceId: entry.workspaceId,
			tabKey: entry.tabKey,
			pid: entry.pty.pid,
		})),
	// Snapshot only: an agent change is not membership, so it must not persist — see SPEC.md.
	onWorkspaceChanged: (workspaceId) => broadcastTabs(workspaceId, listTerminals(workspaceId)),
	// Claude Code runs inline (no alt screen), so mouseModeGuard.transform never sees a trigger for
	// it — this is the fallback: the poller noticing the process is gone is the only signal we get.
	// The command is read once, when the agent appears — the poll itself stays name-only.
	onAgentDetected: (workspaceId, tabKey, agentPid) => {
		const entry = terminals.get(ptyByTab.get(tabIndex(workspaceId, tabKey)) ?? "");
		if (!entry) return;
		const command = captureProcessCommand(agentPid);
		if (!command) return;
		entry.agentCommand = command;
		// Something is running here now: whatever the restore offered is answered, one way or the other.
		carriedAgent.delete(tabIndex(workspaceId, tabKey));
		// The two halves arrive independently: the plugin reports its session id within milliseconds of
		// starting, while this poll can be a tick behind it. Whichever lands second has to write, or a pair
		// only completed after the first write never reaches disk at all.
		if (entry.agentSessionId) persistTerminalSessions();
	},
	onAgentCleared: (workspaceId, tabKey) => {
		const entry = terminals.get(ptyByTab.get(tabIndex(workspaceId, tabKey)) ?? "");
		if (!entry) return;
		// The agent exited, so there is no live session to come back to — see SPEC.md.
		entry.agentCommand = undefined;
		entry.agentSessionId = undefined;
		const reset = entry.mouseModeGuard.resetIfEnabled();
		if (!reset) return;
		entry.recorder.push(reset);
		entry.output.push(reset);
	},
});

const completions = createTerminalCompletionQueue((clientKey, channel, data) =>
	pushToClient(clientKey, channel, data),
);

function ptyEnv(workspaceId: string, tabKey: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === "string") env[key] = value;
	}
	env.TERM = "xterm-256color";
	env.COLORTERM = "truecolor";
	env.THINKRAIL_TERMINAL = "1";
	// Where an agent in this terminal reports what it is doing. A URL rather than a flag, because the
	// report goes straight to the host now — nothing is written into the terminal for some other
	// terminal to render. See SPEC.md.
	const statusUrl = agentStatusUrl(workspaceId, tabKey);
	if (statusUrl !== null) env.THINKRAIL_AGENT_STATUS_URL = statusUrl;
	const mcpUrl = agentMcpUrl(workspaceId, tabKey);
	if (mcpUrl !== null) env.THINKRAIL_MCP_URL = mcpUrl;
	// A `claude` started in this terminal finds the IDE bridge from its own environment, skipping the
	// lock-file scan entirely — the same handoff the official VS Code extension does. See ideBridge/SPEC.md.
	const bridgePort = ideBridgePort();
	if (bridgePort !== null) env[SSE_PORT_ENV] = String(bridgePort);
	return env;
}

const DEFAULT_PTY_SIZE = { cols: 80, rows: 24 } as const;

function replayBudgetChars(): number {
	const configured = loadConfig().terminalReplayKb;
	const kb = Number.isFinite(configured)
		? Math.min(Math.max(Math.trunc(configured), TERMINAL_REPLAY_KB.min), TERMINAL_REPLAY_KB.max)
		: TERMINAL_REPLAY_KB.default;
	return kb * 1024;
}

function tabsFor(workspaceId: string): TabRecord[] {
	let tabs = tabsByWorkspace.get(workspaceId);
	if (!tabs) {
		tabs = [];
		tabsByWorkspace.set(workspaceId, tabs);
	}
	return tabs;
}

function isValidTerminalTabKey(value: unknown): value is string {
	return (
		typeof value === "string" && value.length > 0 && value.length <= MAX_TERMINAL_TAB_KEY_LENGTH
	);
}

function assertTerminalTabKey(tabKey: string): void {
	if (!isValidTerminalTabKey(tabKey)) throw new Error("Invalid terminal tab key");
}

function isValidTerminalTitle(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= MAX_TERMINAL_TITLE_LENGTH;
}

function assertTerminalTitle(title: string): void {
	if (!isValidTerminalTitle(title)) throw new Error("Invalid terminal title");
}

function assertTerminalCatalogCapacity(tabs: readonly TabRecord[]): void {
	if (tabs.length >= MAX_TERMINAL_TABS_PER_WORKSPACE) {
		throw new Error(
			`Terminal tabs are limited to ${MAX_TERMINAL_TABS_PER_WORKSPACE} per workspace`,
		);
	}
}

function spawnForTab(
	workspaceId: string,
	tabKey: string,
	clientKey: string,
	size: { cols?: number; rows?: number },
	revived: string | undefined,
): { id: string; entry: TerminalEntry } {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);

	const shell = terminalShell(process.platform, process.env);
	const grid = {
		cols: size.cols ?? DEFAULT_PTY_SIZE.cols,
		rows: size.rows ?? DEFAULT_PTY_SIZE.rows,
	};
	const pty = spawn(shell, terminalShellArgs(process.platform), {
		name: "xterm-256color",
		cwd: ws.worktreePath,
		...grid,
		env: ptyEnv(workspaceId, tabKey),
	});

	const id = randomUUID();
	const mouseModeGuard = createMouseModeGuard();
	const recorder = createOutputRecorder({ maxChars: replayBudgetChars() });
	if (revived !== undefined) recorder.restore(revived);
	const output = createOutputBatcher({
		...OUTPUT_BATCH,
		onFlush: ({ data, truncated }) => {
			const entry = terminals.get(id);
			if (!entry?.attachedClient) return "unavailable";
			const push: TerminalDataPush = { id, data, truncated };
			return pushToClient(entry.attachedClient, WS_CHANNELS.terminalData, push);
		},
	});
	const entry: TerminalEntry = {
		pty,
		workspaceId,
		tabKey,
		attachedClient: clientKey,
		output,
		recorder,
		mouseModeGuard,
		grid,
	};
	terminals.set(id, entry);
	ptyByTab.set(tabIndex(workspaceId, tabKey), id);

	pty.onData((raw) => {
		const data = mouseModeGuard.transform(raw);
		recorder.push(data);
		output.push(data);
	});
	pty.onExit(({ exitCode }) => {
		if (terminals.get(id) !== entry) return;
		terminals.delete(id);
		const index = tabIndex(entry.workspaceId, entry.tabKey);
		ptyByTab.delete(index);
		const finalScreen = recorder.snapshot();
		if (finalScreen) pendingReplay.set(index, finalScreen);
		// A pair still set here died with the shell, not by the user's hand — carried like the screen. See SPEC.md.
		if (entry.agentCommand && entry.agentSessionId) {
			carriedAgent.set(index, { command: entry.agentCommand, sessionId: entry.agentSessionId });
		}
		recorder.dispose();
		const finalBatch = output.finish();
		const data: TerminalDataPush | undefined = finalBatch
			? { id, data: finalBatch.data, truncated: finalBatch.truncated }
			: undefined;
		const exit: TerminalExitPush = { id, exitCode };
		if (entry.attachedClient) {
			completions.enqueue(entry.attachedClient, { ...(data ? { data } : {}), exit });
		}
	});
	return { id, entry };
}

export function reserveTerminal(
	workspaceId: string,
	tabKey: string,
	title: string,
): TerminalTabInfo {
	assertTerminalTabKey(tabKey);
	assertTerminalTitle(title);
	const tabs = tabsFor(workspaceId);
	const existing = tabs.find((tab) => tab.tabKey === tabKey);
	if (existing) return { tabKey: existing.tabKey, title: existing.title };
	assertTerminalCatalogCapacity(tabs);
	const tab = { tabKey, title };
	tabs.push(tab);
	try {
		persistTerminalSessions();
	} catch (error) {
		tabs.pop();
		if (tabs.length === 0) tabsByWorkspace.delete(workspaceId);
		throw error;
	}
	broadcastTabs(workspaceId, listTerminals(workspaceId));
	return tab;
}

export interface AttachResult {
	id: string;
	created: boolean;
	replay?: string;
	/** Typed into the shell but never run — the user decides whether to resume. See SPEC.md. */
	prefill?: string;
	/** Run the offer instead of typing it: a surface that promised to bring its agent back. */
	prefillSubmit?: boolean;
}

type ResumeRunPolicy = (workspaceId: string, tabKey: string) => boolean;

let resumeRunPolicy: ResumeRunPolicy = () => false;

export function setResumeRunPolicy(policy: ResumeRunPolicy | null): void {
	resumeRunPolicy = policy ?? (() => false);
}

export function attachTerminal(
	workspaceId: string,
	tabKey: string,
	clientKey: string,
	options: { title?: string; cols?: number; rows?: number } = {},
): AttachResult {
	assertTerminalTabKey(tabKey);
	if (options.title !== undefined) assertTerminalTitle(options.title);
	const tabs = tabsFor(workspaceId);
	const isNewTab = !tabs.some((tab) => tab.tabKey === tabKey);
	if (isNewTab) {
		assertTerminalCatalogCapacity(tabs);
		const opened = options.title ?? `Terminal ${tabs.length + 1}`;
		tabs.push({ tabKey, title: opened, defaultTitle: opened });
	}

	const index = tabIndex(workspaceId, tabKey);
	const existingId = ptyByTab.get(index);
	const existing = existingId === undefined ? undefined : terminals.get(existingId);

	if (existing && existingId) {
		if (existing.attachedClient && existing.attachedClient !== clientKey) {
			const push: TerminalDetachedPush = { workspaceId, tabKey };
			pushToClient(existing.attachedClient, WS_CHANNELS.terminalDetached, push);
		}
		existing.attachedClient = clientKey;
		const resized =
			options.cols !== undefined && options.rows !== undefined
				? resizePtyIfChanged(existing.pty, existing.grid, {
						cols: options.cols,
						rows: options.rows,
					})
				: false;
		if (!resized) {
			nudgePtyRedraw(existing.pty, existing.grid, {
				isStillLive: () => terminals.get(existingId) === existing,
			});
		}
		const replay = existing.recorder.snapshot();
		existing.output.reset();
		return { id: existingId, created: false, ...(replay ? { replay } : {}) };
	}

	const revived = pendingReplay.get(index);
	pendingReplay.delete(index);
	// Consumed by the first shell that comes back, not held for every later reattach: the offer belongs to
	// the session that was interrupted, and re-typing it into a shell already in use would be an intrusion.
	const prefill = pendingPrefill.get(index);
	pendingPrefill.delete(index);
	const { id, entry } = spawnForTab(workspaceId, tabKey, clientKey, options, revived);
	// No detection means no `ps` sweep at all: the poll exists to find Claude Code, and a user who has not
	// asked for that integration should not have their process table read every few seconds.
	if (loadConfig().claudeCodeEnabled) agentWatch.poke();
	if (isNewTab) membershipChanged(workspaceId);
	const replay = entry.recorder.snapshot();
	return {
		id,
		created: true,
		...(replay ? { replay } : {}),
		...(prefill ? { prefill } : {}),
		...(prefill && resumeRunPolicy(workspaceId, tabKey) ? { prefillSubmit: true } : {}),
	};
}

export function listTerminals(workspaceId: string): TerminalTabInfo[] {
	return tabsFor(workspaceId).map(({ tabKey, title }) => {
		const agent = agentWatch.agentFor(workspaceId, tabKey);
		return { tabKey, title, ...(agent ? { agent } : {}) };
	});
}

function attachedEntry(id: string, caller: string): TerminalEntry | undefined {
	const entry = terminals.get(id);
	return entry?.attachedClient === caller ? entry : undefined;
}

function announceDisplaced(id: string, caller: string): void {
	const entry = terminals.get(id);
	if (!entry || entry.attachedClient === caller) return;
	const push: TerminalDetachedPush = { workspaceId: entry.workspaceId, tabKey: entry.tabKey };
	pushToClient(caller, WS_CHANNELS.terminalDetached, push);
}

export function writeTerminal(id: string, data: string, caller: string): void {
	const entry = attachedEntry(id, caller);
	if (!entry) {
		announceDisplaced(id, caller);
		return;
	}
	entry.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number, caller: string): void {
	const entry = attachedEntry(id, caller);
	if (!entry) {
		announceDisplaced(id, caller);
		return;
	}
	resizePtyIfChanged(entry.pty, entry.grid, { cols, rows });
}

function disposeTerminalEntry(id: string, entry: TerminalEntry): void {
	terminals.delete(id);
	ptyByTab.delete(tabIndex(entry.workspaceId, entry.tabKey));
	agentWatch.forget(entry.workspaceId, entry.tabKey);
	entry.output.dispose();
	entry.recorder.dispose();
	entry.pty.kill();
}

export interface CloseTabResult {
	closed: boolean;
	busy: boolean;
}

export function closeTerminalTab(
	workspaceId: string,
	tabKey: string,
	force = false,
): CloseTabResult {
	const tabs = tabsFor(workspaceId);
	const position = tabs.findIndex((tab) => tab.tabKey === tabKey);
	if (position === -1) return { closed: false, busy: false };

	const index = tabIndex(workspaceId, tabKey);
	const id = ptyByTab.get(index);
	const entry = id === undefined ? undefined : terminals.get(id);
	if (entry && !force && hasChildProcesses(entry.pty.pid)) return { closed: false, busy: true };

	tabs.splice(position, 1);
	pendingReplay.delete(index);
	pendingPrefill.delete(index);
	carriedAgent.delete(index);
	forgetAgentStatusTokens(workspaceId, tabKey);
	if (entry && id) disposeTerminalEntry(id, entry);
	membershipChanged(workspaceId);
	return { closed: true, busy: false };
}

export function resumeClientTerminals(clientKey: string): void {
	for (const entry of terminals.values()) {
		if (entry.attachedClient === clientKey) entry.output.resume();
	}
	completions.resume(clientKey);
}

export function closeWorkspaceTerminals(workspaceId: string): void {
	for (const [id, entry] of terminals) {
		if (entry.workspaceId === workspaceId) disposeTerminalEntry(id, entry);
	}
	tabsByWorkspace.delete(workspaceId);
	forgetAgentStatusTokens(workspaceId);
	for (const key of pendingReplay.keys()) {
		if (key.startsWith(`${workspaceId}${TAB_INDEX_SEP}`)) pendingReplay.delete(key);
	}
	membershipChanged(workspaceId);
}

export function closeAllTerminals(): void {
	for (const [id, entry] of terminals) disposeTerminalEntry(id, entry);
	completions.clear();
	agentWatch.stop();
}

/**
 * The session id only exists in the agent's own hook output, which reaches the client as a terminal
 * escape sequence — so the client is the one that can see it, and hands it back here to be persisted.
 */
const MAX_TAB_TITLE = 200;

/**
 * Adopt the title the program in the tab set for itself (OSC 0/2), which is how a terminal has always
 * reported what it is running — and how Claude Code names a session.
 *
 * Null bytes are stripped and the length is bounded, because this is arbitrary output from whatever is
 * running. An empty title means "no opinion" and restores the tab's own name rather than blanking it.
 */
export function renameTerminal(workspaceId: string, tabKey: string, title: string): void {
	const tabs = tabsByWorkspace.get(workspaceId);
	const tab = tabs?.find((candidate) => candidate.tabKey === tabKey);
	if (!tabs || !tab) return;
	const cleaned = title.replaceAll("\u0000", "").trim().slice(0, MAX_TAB_TITLE);
	const next = cleaned === "" ? (tab.defaultTitle ?? tab.title) : cleaned;
	if (next === tab.title) return;
	tab.title = next;
	// Broadcast only. A shell repaints its title on every prompt, so persisting here wrote every tab's
	// replay buffer to disk once per command — and the name belongs to the program, not the tab, so it
	// must not outlive it either. Persistence keeps `defaultTitle`; see SPEC.md.
	broadcastTabs(workspaceId, listTerminals(workspaceId));
}

export function rememberAgentSession(workspaceId: string, tabKey: string, sessionId: string): void {
	const entry = terminals.get(ptyByTab.get(tabIndex(workspaceId, tabKey)) ?? "");
	if (!entry || entry.agentSessionId === sessionId) return;
	entry.agentSessionId = sessionId;
	persistTerminalSessions();
}

/** Which agent conversation is live in this tab, as last reported. */
export function agentSessionOf(workspaceId: string, tabKey: string): string | null {
	const entry = terminals.get(ptyByTab.get(tabIndex(workspaceId, tabKey)) ?? "");
	return entry?.agentSessionId ?? null;
}

export function persistTerminalSessions(): void {
	const sessions: PersistedTerminalSessions = {};
	for (const [workspaceId, tabs] of tabsByWorkspace) {
		if (tabs.length === 0) continue;
		sessions[workspaceId] = tabs.map(({ tabKey, title, defaultTitle }) => {
			const index = tabIndex(workspaceId, tabKey);
			const id = ptyByTab.get(index);
			const entry = id === undefined ? undefined : terminals.get(id);
			const recorded = entry ? entry.recorder.snapshot() : pendingReplay.get(index);
			// Only a session still running when we shut down: one the user already ended is not something
			// to bring back — see SPEC.md.
			const live =
				entry?.agentCommand &&
				entry.agentSessionId &&
				agentWatch.agentFor(workspaceId, tabKey) !== undefined
					? { command: entry.agentCommand, sessionId: entry.agentSessionId }
					: undefined;
			// An offer nobody took is still worth making: the user closed the app without answering it, and
			// a shell that was handed the invocation and never ran it kept nothing. See SPEC.md.
			const agent = live ?? carriedAgent.get(index);
			return {
				tabKey,
				title: defaultTitle ?? title,
				...(recorded ? { recorded } : {}),
				...(agent ? { agent } : {}),
			};
		});
	}
	saveTerminalSessions(sessions);
}

export function reviveTerminalSessions(): void {
	for (const [workspaceId, tabs] of Object.entries(loadTerminalSessions())) {
		if (!Array.isArray(tabs)) continue;
		const restored: TabRecord[] = [];
		for (const tab of tabs.slice(0, MAX_TERMINAL_TABS_PER_WORKSPACE)) {
			if (!isValidTerminalTabKey(tab?.tabKey)) continue;
			const title = isValidTerminalTitle(tab.title) ? tab.title : "Terminal";
			restored.push({ tabKey: tab.tabKey, title, defaultTitle: title });
			if (typeof tab.recorded === "string" && tab.recorded !== "") {
				pendingReplay.set(tabIndex(workspaceId, tab.tabKey), tab.recorded);
			}
			const agent = tab.agent;
			if (typeof agent?.command === "string" && typeof agent.sessionId === "string") {
				const cwd = loadWorkspaces().find((w) => w.id === workspaceId)?.worktreePath ?? "";
				const resume = agentSessionExists(cwd, agent.sessionId)
					? resumeCommand(agent.command, agent.sessionId)
					: null;
				if (resume) {
					pendingPrefill.set(tabIndex(workspaceId, tab.tabKey), resume);
					carriedAgent.set(tabIndex(workspaceId, tab.tabKey), {
						command: agent.command,
						sessionId: agent.sessionId,
					});
				}
			}
		}
		if (restored.length > 0) tabsByWorkspace.set(workspaceId, restored);
	}
}

export function resetTerminalState(): void {
	closeAllTerminals();
	terminals.clear();
	ptyByTab.clear();
	tabsByWorkspace.clear();
	pendingReplay.clear();
	pendingPrefill.clear();
	carriedAgent.clear();
}
