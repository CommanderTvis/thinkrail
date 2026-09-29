import type { Static, TObject, TSchema } from "typebox";

/**
 * One wire method's validated shape: a typebox object schema for its params and a typebox schema
 * for its result. The loader validates a call's params against `params` at dispatch, before the
 * registered handler runs; this is the first server-side validation in the codebase.
 */
export interface PluginMethodSpec<P extends TObject = TObject, R extends TSchema = TSchema> {
	/** Typebox schema the method's params are validated against. */
	params: P;
	/** Typebox schema of the method's result. Not validated per call; pinned by fixture tests instead. */
	result: R;
}

/**
 * One wire channel's shape, declared as a state channel or an event channel.
 *
 * A state channel names the method that returns its current value (`snapshot`) and the param
 * fields that key a subscription to one scope (`key`), so a subscriber can read the snapshot for
 * its own pane on mount and on reconnect rather than replaying from a cache.
 *
 * An event channel has no snapshot and is documented as lossy: it exists for host-to-client
 * requests that time out on their own, not for state a late subscriber must recover.
 */
export type PluginChannelSpec<T extends TSchema = TSchema, Methods extends string = string> =
	| { kind: "state"; payload: T; snapshot: Methods; key: readonly string[] }
	| { kind: "event"; payload: T };

/**
 * A plugin's one wire contract: its declared methods, channels, and settings schema under a
 * single wire version. A host half imports the contract value (wrapped in
 * {@link definePluginContract}) and validates against it; a web half never imports the value,
 * only its shape via `import type` and the `MethodParams`/`MethodResult`/`ChannelPayload`/
 * `PluginSettings` projections below, which is what keeps typebox out of the browser bundle.
 */
export interface PluginContract<
	Id extends string = string,
	M extends Record<string, PluginMethodSpec> = Record<string, PluginMethodSpec>,
	C extends Record<string, PluginChannelSpec> = Record<string, PluginChannelSpec>,
	S extends TObject = TObject,
> {
	/** The plugin's id; every method and channel name is namespaced under it. */
	id: Id;
	/** Incremented whenever `methods` or `channels` change; a web half at a different version stays dormant. */
	wireVersion: number;
	/** The plugin's WS request methods, keyed by name. */
	methods: M;
	/** The plugin's channels, keyed by name. */
	channels: C;
	/** Typebox object schema for the plugin's settings namespace. */
	settings: S;
}

/**
 * Identity helper that returns `contract` unchanged while inferring its literal method, channel,
 * and settings types. A plugin's host half wraps its contract value in this and passes the result
 * to {@link PluginHostModule.contract}.
 * @param contract the plugin's wire contract
 * @returns `contract`, unchanged
 * @example
 * ```ts
 * export const contract = definePluginContract({
 *   id: "todo-board",
 *   wireVersion: 1,
 *   methods: {
 *     listTodos: { params: Type.Object({}), result: Type.Array(Type.String()) },
 *   },
 *   channels: {
 *     todos: { kind: "state", payload: Type.Array(Type.String()), snapshot: "listTodos", key: [] },
 *   },
 *   settings: Type.Object({ showDone: Type.Boolean({ default: false }) }),
 * });
 * ```
 */
export function definePluginContract<const C extends PluginContract>(contract: C): C {
	return contract;
}

/** The validated param type of contract `C`'s method `M`, projected from its typebox `params` schema. */
export type MethodParams<C extends PluginContract, M extends keyof C["methods"]> = Static<
	C["methods"][M]["params"]
>;

/** The result type of contract `C`'s method `M`, projected from its typebox `result` schema. */
export type MethodResult<C extends PluginContract, M extends keyof C["methods"]> = Static<
	C["methods"][M]["result"]
>;

/** The payload type of contract `C`'s channel `K`, projected from its typebox `payload` schema. */
export type ChannelPayload<C extends PluginContract, K extends keyof C["channels"]> = Static<
	C["channels"][K]["payload"]
>;

/** The settings type of contract `C`, projected from its typebox `settings` schema. */
export type PluginSettings<C extends PluginContract> = Static<C["settings"]>;
