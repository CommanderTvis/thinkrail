import { type VisualizeParams, VisualizeSchema } from "pi-visualize/schema";
import { validateShape } from "pi-visualize/validate";
import type { TerminalVisualization, VisualizationsChangedPayload } from "../contracts";

export { VisualizeSchema };

type Publisher = (payload: VisualizationsChangedPayload) => void;
type AgentSessionLookup = (workspaceId: string, tabKey: string) => string | null;
type PersistedVisualizations = Record<string, Record<string, TerminalVisualization>>;
interface PersistedStore {
	read: () => PersistedVisualizations;
	write: (value: PersistedVisualizations) => void;
}

let publish: Publisher | null = null;
let agentSessionOf: AgentSessionLookup = () => null;
let persisted: PersistedStore = { read: () => ({}), write: () => {} };

export function setVisualizationPublisher(fn: Publisher | null): void {
	publish = fn;
}

/** How this module learns which conversation a terminal is running — injected by the host half. */
export function setAgentSessionLookup(fn: AgentSessionLookup | null): void {
	agentSessionOf = fn ?? (() => null);
}

/** Where drawings survive a restart — injected by the host half over `ctx.readState`/`writeState`. */
export function setVisualizationStore(store: PersistedStore): void {
	persisted = store;
}

const byTerminal = new Map<string, TerminalVisualization>();

/** How long the tool waits for a client to say whether the drawing rendered. */
const RENDER_VERDICT_TIMEOUT_MS = 5_000;

interface PendingVerdict {
	resolve: (error: string | null) => void;
	timer: ReturnType<typeof setTimeout>;
}

const pendingVerdicts = new Map<string, PendingVerdict>();

function verdictKey(workspaceId: string, tabKey: string, revision: number): string {
	return `${workspaceId} ${tabKey} ${revision}`;
}

/**
 * The renderer decides. Mermaid is parsed in the browser, so whether a diagram is valid is not something
 * this process can answer — the client that draws it reports back, and the tool call resolves with that
 * verdict so a bad diagram reaches the agent as a tool error rather than a red card only the user sees.
 * No client watching is not a failure: the wait times out and the drawing stands. See SPEC.md.
 */
export function reportVisualizationRender(
	workspaceId: string,
	tabKey: string,
	revision: number,
	error: string | null,
): void {
	const key = verdictKey(workspaceId, tabKey, revision);
	const pending = pendingVerdicts.get(key);
	if (!pending) return;
	pendingVerdicts.delete(key);
	clearTimeout(pending.timer);
	pending.resolve(error);
}

function awaitRenderVerdict(
	workspaceId: string,
	tabKey: string,
	revision: number,
): Promise<string | null> {
	const key = verdictKey(workspaceId, tabKey, revision);
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			pendingVerdicts.delete(key);
			resolve(null);
		}, RENDER_VERDICT_TIMEOUT_MS);
		pendingVerdicts.set(key, { resolve, timer });
	});
}

function terminalKey(workspaceId: string, tabKey: string): string {
	return `${workspaceId} ${tabKey}`;
}

export function getVisualization(
	workspaceId: string,
	tabKey: string,
): TerminalVisualization | null {
	return byTerminal.get(terminalKey(workspaceId, tabKey)) ?? null;
}

export function visualizationsForWorkspace(
	workspaceId: string,
): Record<string, TerminalVisualization> {
	const prefix = `${workspaceId} `;
	const result: Record<string, TerminalVisualization> = {};
	for (const [key, value] of byTerminal) {
		if (key.startsWith(prefix)) result[key.slice(prefix.length)] = value;
	}
	return result;
}

function publishWorkspace(workspaceId: string): void {
	publish?.({ workspaceId, visualizations: visualizationsForWorkspace(workspaceId) });
}

function rememberForSession(
	workspaceId: string,
	sessionId: string,
	visualization: TerminalVisualization,
): void {
	const all = persisted.read();
	persisted.write({
		...all,
		[workspaceId]: { ...all[workspaceId], [sessionId]: visualization },
	});
}

/**
 * A resumed conversation reclaims its drawing. `claude --resume <id>` lands in whatever terminal the user
 * opened, which is rarely the one that drew — so the session's last visualization is re-attached to the
 * tab now reporting that session, and pushed as if it had just been drawn. See SPEC.md.
 */
export function adoptVisualizationForSession(
	workspaceId: string,
	tabKey: string,
	sessionId: string,
): TerminalVisualization | null {
	const stored = persisted.read()[workspaceId]?.[sessionId];
	const current = byTerminal.get(terminalKey(workspaceId, tabKey));
	if (!stored) {
		// The tab drew before it said which conversation it was: bind what it has to the session now, so
		// a later resume can reclaim it.
		if (current) rememberForSession(workspaceId, sessionId, current);
		return null;
	}
	if (current && current.revision >= stored.revision) return null;
	byTerminal.set(terminalKey(workspaceId, tabKey), stored);
	publishWorkspace(workspaceId);
	return stored;
}

export function forgetVisualizations(workspaceId: string): void {
	const prefix = `${workspaceId} `;
	for (const key of [...byTerminal.keys()]) {
		if (key.startsWith(prefix)) byTerminal.delete(key);
	}
	const all = persisted.read();
	if (!(workspaceId in all)) return;
	const { [workspaceId]: _dropped, ...rest } = all;
	persisted.write(rest);
}

function restoreVisualization(
	workspaceId: string,
	tabKey: string,
	visualization: TerminalVisualization,
): void {
	byTerminal.set(terminalKey(workspaceId, tabKey), visualization);
	publishWorkspace(workspaceId);
}

export function resetVisualizations(): void {
	byTerminal.clear();
	for (const pending of pendingVerdicts.values()) clearTimeout(pending.timer);
	pendingVerdicts.clear();
}

export function recordVisualization(
	workspaceId: string,
	tabKey: string,
	params: VisualizeParams,
): TerminalVisualization {
	const key = terminalKey(workspaceId, tabKey);
	const revision = (byTerminal.get(key)?.revision ?? 0) + 1;
	const title = params.title || (params.type === "comparison" ? "Comparison" : "Diagram");
	const visualization: TerminalVisualization = {
		title,
		args: params as Record<string, unknown>,
		revision,
	};
	byTerminal.set(key, visualization);
	const sessionId = agentSessionOf(workspaceId, tabKey);
	if (sessionId !== null) rememberForSession(workspaceId, sessionId, visualization);
	publishWorkspace(workspaceId);
	return visualization;
}

export const VISUALIZE_TOOL_DESCRIPTION =
	"Render a rich visualization in the ThinkRail workbench, in a live view beside this terminal — " +
	"instead of ASCII art or a plain markdown table. Two kinds, chosen by `type`: 'diagram' renders a " +
	"mermaid diagram (set `mermaid` to raw mermaid source of any kind — flowchart, sequenceDiagram, " +
	"classDiagram, stateDiagram, erDiagram, gantt); 'comparison' renders side-by-side option cards " +
	"(set `options` to the alternatives, each with pros/cons, an optional `recommended` flag, and an " +
	"optional inline `mermaid`). Calling again replaces this terminal's view in place, so you can " +
	"iterate on a diagram and the user watches it evolve.";

/** Runs the `visualize` tool for one terminal: record the drawing, then await the browser's render verdict. */
export async function runVisualizeTool(
	owner: { workspaceId: string; tabKey: string },
	args: VisualizeParams,
): Promise<{ text: string; isError?: boolean }> {
	try {
		validateShape(args);
	} catch (err) {
		return { text: (err as Error).message, isError: true };
	}
	const previous = getVisualization(owner.workspaceId, owner.tabKey);
	const visualization = recordVisualization(owner.workspaceId, owner.tabKey, args);
	const failure = await awaitRenderVerdict(owner.workspaceId, owner.tabKey, visualization.revision);
	if (failure !== null) {
		// A drawing that does not render is not this terminal's view: the last one that did stands,
		// so a typo in an iteration does not cost the user the picture they had. See SPEC.md.
		if (previous) restoreVisualization(owner.workspaceId, owner.tabKey, previous);
		return {
			text: `The diagram did not render: ${failure}\nFix the mermaid source and call visualize again.`,
			isError: true,
		};
	}
	return {
		text: `Rendered "${visualization.title}" in ThinkRail (revision ${visualization.revision}). Call visualize again to update it in place.`,
	};
}
