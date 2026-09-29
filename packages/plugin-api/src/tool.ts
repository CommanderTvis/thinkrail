import type { Static, TObject } from "typebox";

/** Identifies one terminal tab: the workspace it belongs to and its tab key within that workspace. */
export type TerminalRef = { workspaceId: string; tabKey: string };

/** Where a registered tool is exposed: to the agent (`"agent"`) or over the per-terminal MCP table (`"mcp"`). */
export type PluginToolSurface = "agent" | "mcp";

/** Passed to a {@link PluginToolDefinition.run} function, describing the call site the tool ran from. */
export interface PluginToolContext {
	/** The resolved working directory for the call. */
	cwd: string;
	/** The workspace the call ran in, or `null` outside any workspace. */
	workspaceId: string | null;
	/** The terminal that owns the call, when the tool ran on the MCP surface. */
	terminal?: TerminalRef;
	/** The pi session id, when the tool ran on the agent surface. */
	sessionId?: string;
}

/** The value a {@link PluginToolDefinition.run} function returns. */
export interface PluginToolResult {
	/** The tool's textual result, shown to the agent or the MCP caller. */
	text: string;
	/** Marks `text` as an error message rather than a normal result. */
	isError?: boolean;
	/** Structured detail alongside `text`, for a renderer registered against this tool's name. */
	details?: unknown;
}

/**
 * A pi-free declaration of one tool, registered with {@link PluginHostContext.tool}. The loader
 * adapts it to a pi tool through a core extension and, for the `"mcp"` surface, to a handle on the
 * per-terminal MCP table bound to the token owner — a plugin never imports a `pi` package to
 * declare a tool. A renderer joins by `name` through `registerToolRenderer`, reached from the web
 * context rather than by importing the chat module.
 */
export interface PluginToolDefinition<P extends TObject = TObject> {
	/** The tool's name; also what a `registerToolRenderer` call joins against. */
	name: string;
	/** Shown wherever the tool is listed to the user. */
	label: string;
	/** Shown to the agent alongside the tool's schema. */
	description: string;
	/** Optional text appended to the system prompt introducing this tool, when the plugin needs more than `description` conveys. */
	promptSnippet?: string;
	/** Typebox object schema the tool's params are validated against. */
	parameters: P;
	/** Which surfaces the tool is exposed on; see {@link PluginToolSurface}. */
	surfaces: readonly PluginToolSurface[];
	/**
	 * Runs the tool.
	 * @param params the call's params, validated against `parameters`
	 * @param ctx the call site the tool ran from
	 * @returns the tool's result, or a promise of one
	 */
	run(params: Static<P>, ctx: PluginToolContext): PluginToolResult | Promise<PluginToolResult>;
}

/**
 * Identity helper that returns `tool` unchanged while inferring its literal `parameters` type, so
 * `run`'s `params` argument is typed from `parameters` rather than widened to `unknown`.
 * @param tool the tool declaration
 * @returns `tool`, unchanged
 */
export function definePluginTool<P extends TObject>(
	tool: PluginToolDefinition<P>,
): PluginToolDefinition<P> {
	return tool;
}
