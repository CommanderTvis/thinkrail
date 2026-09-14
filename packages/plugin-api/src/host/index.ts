/**
 * @packageDocumentation
 * The engine-host half of `@thinkrail/plugin-api`: {@link PluginHostContext} and the types its
 * members use. Imported by `packages/server` and by a plugin's host half; never by `apps/web` or
 * any web-bundled code, since it is a value-import surface a plugin's host module runs against
 * in-process.
 */

import type {
	Project,
	TerminalAgentRecord,
	Workspace,
	WorkspaceFsChangedPayload,
} from "@thinkrail/contracts";
import type {
	ChannelPayload,
	MethodParams,
	MethodResult,
	PluginContract,
	PluginSettings,
} from "../contract";
import type { PluginManifest } from "../manifest";
import type { PluginToolDefinition, TerminalRef } from "../tool";

/** The logger handed to a plugin's host half as {@link PluginHostContext.log}, one level per method. */
export interface PluginLogger {
	debug(msg: string, fields?: object): void;
	info(msg: string, fields?: object): void;
	warn(msg: string, fields?: object): void;
	error(msg: string, fields?: object): void;
}

/**
 * The cleanup function a {@link PluginHostActivate} may return. On a toggle the loader awaits it,
 * bounded by a timeout; on host shutdown it is not awaited, since `stop()` is synchronous. Runs
 * only after routing has stopped and in-flight work belonging to the activation has drained.
 */
export type PluginDisposer = () => void | Promise<void>;

/** Identifies the caller of a method handler, for the per-client addressing {@link PluginHostContext.method} and {@link PluginHostContext.publish} support. */
export interface PluginCall {
	/** Opaque key of the calling client, usable as a `publish` target. */
	clientKey: string;
}

/** A terminal lifecycle event delivered to a handler registered with {@link PluginHostContext.onTerminal}. */
export type TerminalEvent =
	| { kind: "spawned"; terminal: TerminalRef; pid: number }
	| { kind: "exited"; terminal: TerminalRef; exitCode: number }
	| { kind: "closed"; terminal: TerminalRef }
	| { kind: "agentChanged"; terminal: TerminalRef; record: TerminalAgentRecord | null };

/** A workspace lifecycle event delivered to a handler registered with {@link PluginHostContext.onWorkspace}. */
export type WorkspaceEvent =
	| { kind: "created" | "updated"; workspace: Workspace }
	| { kind: "removed"; projectId: string; id: string };

/** The value a {@link PluginHostContext.revivePrefill} hook returns to prefill a revived terminal's `terminal.attach`. */
export interface RevivePrefill {
	/** Text to prefill into the revived terminal. */
	text?: string;
	/** Whether to submit `text` immediately rather than leaving it staged. */
	submit?: boolean;
}

/** Options for {@link PluginHostContext.git}. */
export interface GitRunOptions {
	/** Aborts the git process after this many milliseconds. */
	timeoutMs?: number;
	/** Allows the git process network access; denied by default. */
	network?: boolean;
}

/** The result of a {@link PluginHostContext.git} call. */
export interface GitRunResult {
	/** Whether the process exited successfully. */
	ok: boolean;
	/** Captured stdout. */
	out: string;
	/** Captured stderr. */
	err: string;
	/** Set when `ok` is `false` because the process was killed on timeout or never launched. */
	failure?: "timeout" | "launch";
}

/**
 * What a declared {@link PluginDependency} grants at runtime: calling the dependency's wire
 * methods and subscribing to its channels, in-process rather than over the socket. Obtained from
 * {@link PluginHostContext.dependency}. Grants nothing beyond these two calls — no shared objects,
 * no access to the dependency's other host half internals.
 */
export interface DependencyHandle<D extends PluginContract> {
	/**
	 * Calls one of the dependency's declared methods in-process.
	 * @param name the method name from the dependency's contract
	 * @param params the method's params, validated against the dependency's schema
	 * @returns the method's result
	 */
	request<M extends keyof D["methods"]>(
		name: M,
		params: MethodParams<D, M>,
	): Promise<MethodResult<D, M>>;
	/**
	 * Subscribes to one of the dependency's declared channels.
	 * @param channel the channel name from the dependency's contract
	 * @param handler called with each pushed payload
	 * @returns a function that cancels the subscription
	 */
	subscribe<K extends keyof D["channels"]>(
		channel: K,
		handler: (payload: ChannelPayload<D, K>) => void,
	): () => void;
}

/**
 * The context passed to a plugin's {@link PluginHostActivate} function: the closed set of
 * seventeen host capabilities (H1–H17 in the module spec). Every registration made through it is
 * recorded by the loader and torn down on dispose, so a plugin keeps no cleanup bookkeeping of its
 * own. All members are only meaningful to call during or after `activate` runs; once the
 * activation is disposed, registrations made through it stop taking effect.
 */
export interface PluginHostContext<C extends PluginContract> {
	/** The plugin's id, from its contract. */
	readonly id: C["id"];
	/** This activation's logger. */
	readonly log: PluginLogger;
	/** The plugin's assets directory, from the manifest's `assets`, or `null` when none was declared. */
	readonly assetsDir: string | null;

	/**
	 * Registers a handler for one of the contract's WS request methods (H1). Params are validated
	 * against the contract's schema before `handler` runs. While the plugin is disabled the method
	 * answers a plain disabled error instead of calling `handler`.
	 * @param name the method name from the contract
	 * @param handler called with the validated params and the calling client
	 */
	method<M extends keyof C["methods"] & string>(
		name: M,
		handler: (
			params: MethodParams<C, M>,
			call: PluginCall,
		) => MethodResult<C, M> | Promise<MethodResult<C, M>>,
	): void;

	/**
	 * Publishes a payload on one of the contract's declared channels (H2), to every subscriber or,
	 * with `target`, to one client. While the plugin is disabled this is a no-op; channels remain
	 * subscribed regardless of enablement, so a publish never reaches an unsubscribed topic
	 * silently.
	 * @param channel the channel name from the contract
	 * @param payload the channel's payload, matching its declared schema
	 * @param target when given, addresses the publish to this client only
	 */
	publish<K extends keyof C["channels"] & string>(
		channel: K,
		payload: ChannelPayload<C, K>,
		target?: PluginCall,
	): void;

	/**
	 * Mounts an HTTP route under `/plugin/<id>/` (H3). While the plugin is disabled, requests under
	 * its route answer 404 instead of reaching `handler`.
	 * @param handler called with the request and the subpath under the plugin's route
	 */
	route(handler: (request: Request, subpath: string) => Response | Promise<Response>): void;

	/** Returns the public base URL a plugin's own route is reachable at (H3). */
	publicBaseUrl(): string;

	/**
	 * Registers a pi-free tool (H4). While the plugin is disabled, the tool is removed from the set
	 * future sessions and turns will see; a call already executing still finishes.
	 * @param definition the tool declaration, typically built with {@link definePluginTool}
	 */
	tool(definition: PluginToolDefinition): void;

	/**
	 * Registers a contributor of PTY environment variables, computed per terminal at spawn (H5).
	 * Only future terminals see the contribution — a running terminal keeps the environment it was
	 * given at spawn, since there is no way to restamp a live process.
	 * @param contributor called with the spawning terminal, returning env vars to add
	 */
	terminalEnv(contributor: (terminal: TerminalRef) => Record<string, string>): void;

	/** Mints an opaque identity token for `terminal` (H6), usable to authenticate calls back to the host for that terminal. */
	terminalToken(terminal: TerminalRef): string;
	/** Resolves a token minted by {@link PluginHostContext.terminalToken} back to its terminal, or `null` if it is unknown. */
	terminalForToken(token: string): TerminalRef | null;

	/** Reads the persisted, broadcast agent record for `terminal` (H7), or `null` when none is set. */
	agentRecord(terminal: TerminalRef): TerminalAgentRecord | null;
	/** Writes the persisted agent record for `terminal` (H7); `null` clears it. Dropped when the terminal closes. */
	setAgentRecord(terminal: TerminalRef, record: TerminalAgentRecord | null): void;

	/**
	 * Registers an observer of terminal lifecycle events (H8): spawned, exited, closed, and agent
	 * record changes.
	 * @param handler called with each event
	 */
	onTerminal(handler: (event: TerminalEvent) => void): void;
	/** Lists currently known terminals with their process id, or `null` when not yet spawned or already exited (H8). */
	terminals(): readonly (TerminalRef & { pid: number | null })[];
	/** Resolves the workspace a running process belongs to, by pid, or `null` if unknown (H8). */
	workspaceForProcess(pid: number): string | null;

	/**
	 * Registers a hook offering a prefill for a terminal being revived (H9), returned to the client
	 * from `terminal.attach`.
	 * @param hook called with the reviving terminal and its agent record; returns a prefill or `null`
	 */
	revivePrefill(
		hook: (terminal: TerminalRef, record: TerminalAgentRecord) => RevivePrefill | null,
	): void;

	/** Writes `data` into `terminal` host-side, bypassing client attachment (H10). */
	writeTerminal(terminal: TerminalRef, data: string): void;

	/** Sends `text` to a pi session, steering it while it streams rather than throwing (H11). */
	sendToSession(sessionId: string, text: string): Promise<void>;

	/** Lists known projects (H12). */
	projects(): readonly Project[];
	/** Lists workspaces, optionally scoped to one project (H12). */
	workspaces(projectId?: string): readonly Workspace[];
	/** Reads one workspace by id, or `null` if it does not exist (H12). */
	workspace(id: string): Workspace | null;
	/** Starts watching a workspace for filesystem changes, feeding {@link PluginHostContext.onFsChanged} (H12). */
	watchWorkspace(id: string): Promise<void>;
	/** Registers an observer of workspace lifecycle events (H12). */
	onWorkspace(handler: (event: WorkspaceEvent) => void): void;
	/** Registers an observer of batched filesystem-change events for watched workspaces (H12). */
	onFsChanged(handler: (payload: WorkspaceFsChangedPayload) => void): void;
	/**
	 * Feeds a hint into a workspace's auto-naming (H12).
	 * @param workspaceId the workspace to name
	 * @param hint text to derive a name from
	 */
	suggestWorkspaceName(workspaceId: string, hint: { prompt?: string; turn?: string }): void;

	/** Reads the plugin's own settings namespace, validated and defaulted (H13). */
	settings(): PluginSettings<C>;
	/** Registers an observer called with the plugin's settings whenever they change (H13). */
	onSettings(handler: (next: PluginSettings<C>) => void): void;

	/**
	 * Reads namespaced JSON state persisted under the data directory, at the path
	 * {@link pluginStateFile} builds for `name` (H14).
	 * @param name the state file name
	 * @param fallback returned when the file does not exist or fails to parse
	 * @returns the parsed value, or `fallback`
	 */
	readState<T>(name: string, fallback: T): T;
	/**
	 * Writes namespaced JSON state persisted under the data directory (H14). Survives the plugin
	 * being disabled or replaced, since code and state live in sibling trees.
	 * @param name the state file name
	 * @param value the value to persist as JSON
	 */
	writeState(name: string, value: unknown): void;

	/**
	 * Runs git through the host's bounded runner (H17), which disables terminal prompts, runs
	 * without a console window, and sets `GIT_OPTIONAL_LOCKS=0` so a host-side read is not mistaken
	 * by the watcher for a repository change.
	 * @param cwd the directory to run git in
	 * @param args the git arguments
	 * @param options timeout and network access
	 */
	git(cwd: string, args: readonly string[], options?: GitRunOptions): Promise<GitRunResult>;

	/**
	 * Resolves a handle to a declared dependency's wire surface, for a plugin listed in this
	 * plugin's manifest `dependsOn`.
	 * @param contract the dependency's contract value
	 * @returns a handle to call the dependency's methods and subscribe to its channels
	 */
	dependency<D extends PluginContract>(contract: D): DependencyHandle<D>;
}

/**
 * A plugin's host entry point. Called once per activation with a fresh {@link PluginHostContext};
 * every registration made through that context takes effect immediately and is torn down on
 * dispose. Each activation gets a monotonically increasing activation id, and anything the loader
 * receives from a stale activation — a late publish, a timer the plugin forgot to clear — is
 * dropped rather than reaching a client.
 * @param ctx this activation's host context
 * @returns nothing, or a {@link PluginDisposer} to run on dispose
 */
export type PluginHostActivate<C extends PluginContract> = (
	ctx: PluginHostContext<C>,
) => undefined | PluginDisposer | Promise<undefined | PluginDisposer>;

/** The value a plugin's host entry module exports by default, built with {@link definePluginHost}. */
export interface PluginHostModule<C extends PluginContract = PluginContract> {
	/** The plugin's manifest. */
	manifest: PluginManifest;
	/** The plugin's wire contract, typically built with `definePluginContract`. */
	contract: C;
	/** The plugin's activate function. */
	activate: PluginHostActivate<C>;
}

/**
 * Identity helper that returns `module` unchanged while inferring its contract's literal type, so
 * `activate`'s context is typed against the exact `contract` given here.
 * @param module the plugin's manifest, contract, and activate function
 * @returns `module`, unchanged
 * @example
 * ```ts
 * export default definePluginHost({
 *   manifest,
 *   contract,
 *   activate(ctx) {
 *     ctx.method("listTodos", async () => ctx.readState("todos", []));
 *     ctx.tool(
 *       definePluginTool({
 *         name: "add_todo",
 *         label: "Add Todo",
 *         description: "Adds a todo item",
 *         parameters: Type.Object({ text: Type.String() }),
 *         surfaces: ["agent"],
 *         run: ({ text }) => ({ text: `added: ${text}` }),
 *       }),
 *     );
 *   },
 * });
 * ```
 */
export function definePluginHost<C extends PluginContract>(
	module: PluginHostModule<C>,
): PluginHostModule<C> {
	return module;
}
