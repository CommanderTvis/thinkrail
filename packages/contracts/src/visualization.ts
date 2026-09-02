/**
 * A visualization drawn by the agent running in a terminal — the MCP `visualize` tool's live view.
 *
 * `args` is the tool call's arguments verbatim; the web renders them with the same card the chat uses
 * for pi's visualize tool, so both agents draw with one vocabulary. `revision` bumps on every rewrite:
 * the same terminal calling again updates its view in place rather than opening a second one.
 */
export interface TerminalVisualization {
	title: string;
	args: Record<string, unknown>;
	revision: number;
}

export interface VisualizationPush {
	workspaceId: string;
	tabKey: string;
	visualization: TerminalVisualization;
}
