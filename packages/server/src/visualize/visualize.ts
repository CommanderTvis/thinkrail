import type { TerminalVisualization, VisualizationPush } from "@thinkrail/contracts";
import { type VisualizeParams, VisualizeSchema } from "pi-visualize/schema";
import { validateShape } from "pi-visualize/validate";
import { Value } from "typebox/value";
import { loadVisualizations, saveVisualizations } from "../persistence";

type VisualizationPublisher = (push: VisualizationPush) => void;
type AgentSessionLookup = (workspaceId: string, tabKey: string) => string | null;

let publish: VisualizationPublisher | null = null;
let agentSessionOf: AgentSessionLookup = () => null;

export function setVisualizationPublisher(fn: VisualizationPublisher | null): void {
	publish = fn;
}

/** How this module learns which conversation a terminal is running — injected by `host`. */
export function setAgentSessionLookup(fn: AgentSessionLookup | null): void {
	agentSessionOf = fn ?? (() => null);
}

const byTerminal = new Map<string, TerminalVisualization>();

function terminalKey(workspaceId: string, tabKey: string): string {
	return `${workspaceId} ${tabKey}`;
}

export function getVisualization(
	workspaceId: string,
	tabKey: string,
): TerminalVisualization | null {
	return byTerminal.get(terminalKey(workspaceId, tabKey)) ?? null;
}

function rememberForSession(
	workspaceId: string,
	sessionId: string,
	visualization: TerminalVisualization,
): void {
	const all = loadVisualizations();
	saveVisualizations({
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
	const stored = loadVisualizations()[workspaceId]?.[sessionId];
	const current = byTerminal.get(terminalKey(workspaceId, tabKey));
	if (!stored) {
		// The tab drew before it said which conversation it was: bind what it has to the session now, so
		// a later resume can reclaim it.
		if (current) rememberForSession(workspaceId, sessionId, current);
		return null;
	}
	if (current && current.revision >= stored.revision) return null;
	byTerminal.set(terminalKey(workspaceId, tabKey), stored);
	publish?.({ workspaceId, tabKey, visualization: stored });
	return stored;
}

export function forgetVisualizations(workspaceId: string): void {
	for (const key of [...byTerminal.keys()]) {
		if (key.startsWith(`${workspaceId} `)) byTerminal.delete(key);
	}
	const all = loadVisualizations();
	if (!(workspaceId in all)) return;
	const { [workspaceId]: _dropped, ...rest } = all;
	saveVisualizations(rest);
}

export function resetVisualizations(): void {
	byTerminal.clear();
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
	publish?.({ workspaceId, tabKey, visualization });
	return visualization;
}

const DESCRIPTION =
	"Render a rich visualization in the ThinkRail workbench, in a live view beside this terminal — " +
	"instead of ASCII art or a plain markdown table. Two kinds, chosen by `type`: 'diagram' renders a " +
	"mermaid diagram (set `mermaid` to raw mermaid source of any kind — flowchart, sequenceDiagram, " +
	"classDiagram, stateDiagram, erDiagram, gantt); 'comparison' renders side-by-side option cards " +
	"(set `options` to the alternatives, each with pros/cons, an optional `recommended` flag, and an " +
	"optional inline `mermaid`). Calling again replaces this terminal's view in place, so you can " +
	"iterate on a diagram and the user watches it evolve.";

export function visualizeMcpTool(owner: { workspaceId: string; tabKey: string }): {
	name: string;
	description: string;
	inputSchema: object;
	call(args: Record<string, unknown>): { text: string; isError?: boolean };
} {
	return {
		name: "visualize",
		description: DESCRIPTION,
		inputSchema: VisualizeSchema,
		call(args) {
			if (!Value.Check(VisualizeSchema, args)) {
				return { text: "Invalid arguments for visualize — see the tool's schema.", isError: true };
			}
			try {
				validateShape(args);
			} catch (err) {
				return { text: (err as Error).message, isError: true };
			}
			const visualization = recordVisualization(owner.workspaceId, owner.tabKey, args);
			return {
				text: `Rendered "${visualization.title}" in ThinkRail (revision ${visualization.revision}). Call visualize again to update it in place.`,
			};
		},
	};
}
