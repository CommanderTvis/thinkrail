---
id: submodule-server-plugins
type: submodule-design
status: active
title: plugins — the server-side plugin loader
parent: module-server
depends-on:
  [module-plugin-api, module-contracts, submodule-server-persistence, submodule-server-log]
tags: [v1]
---

## Responsibility

Turns `PluginHostModule`s — builtin (`BUILTIN_PLUGINS`: spec-dialect, blueprint, claude-code) or external
(`<dataDir>/plugins/<id>/thinkrail-plugin.json` plus `AppConfig.pluginPaths`) — into one running
`PluginRuntime`: a roster the host can publish, a `plugin.<id>.<name>` method/route dispatcher, the pi
tool and resource surface a session needs, and the terminal/workspace/settings fan-out every active
plugin's host context subscribed to. `installPlugins(seams)` is the composition root; everything else
in this directory is a leaf it wires together.

## The boundary

Every core capability arrives as one injected closure object, `PluginHostSeams` (`seams.ts`) — `dataDir`,
`publish`/`publishRoster`, `publicBaseUrl`, `terminal.*`, `sessions.send`, `workspaces.*`, `git`,
`config`, `resourcesChanged`, `logger`. No file in this directory imports a sibling feature module
(`../terminal`, `../workspaces`, `../settings`, `../agent`, …) directly — the only value imports outside
this directory are `@thinkrail/contracts`, `@thinkrail/plugin-api` (+ `/host`), `typebox` +
`typebox/value`, `../log`, `../persistence` (`readPluginState`/`writePluginState`), and, type-only,
`../mcp`'s `McpToolHandle` and `@earendil-works/pi-coding-agent`'s `ExtensionAPI`/`ExtensionFactory`/
`ToolDefinition`. `../log`'s `Logger` (`debug`/`info`/`warn`/`error`, each `(message, error?: unknown)`)
is adapted to the plugin-facing `PluginLogger` (`(msg, fields?: object)`) once, in `activation.ts` — the
second parameter's name changes, not its type, since `error?: unknown` already accepts a fields object.
Everything that reaches a plugin author (`PluginHostContext`, `PluginManifest`, `PluginContract`) is
`@thinkrail/plugin-api`'s public surface, imported verbatim, never redeclared here.

`packages/server/package.json` carries one added line (`@thinkrail/plugin-api: workspace:*`) and
`scripts/check-module-boundaries.ts` one added allowed-target (`packages/plugin-api` under
`packages/server`) — both were already present when this module was written (a prior stage had added
them ahead of this one landing), verified rather than re-added.

## Manifest-only builtins (no host half)

A builtin plugin whose manifest declares no `host` — `pdf-preview` is the first — is registered with
`registry.registerBuiltinManifest(manifest)` instead of `registerBuiltin(module)`: the entry carries a
manifest and no `module` at all. `activation.ts`'s `activate()` checks `!entry.manifest.host` before
its builtin-specific "no host module registered" failure, so such an entry goes straight to `"active"`
with no activation tables ever created; `deactivate()` already no-ops on an entry with no `activation`,
so teardown needs no special case. Every module-scoped lookup elsewhere in this directory
(`toRosterChannels`, `pluginChannelNames`, `callPluginMethod`, `pluginPiResources`) already guards on
`entry.module` being present, so a host-less builtin simply contributes an empty channel/method surface
and no pi resources — it is visible in the roster (enable/disable in Settings, its
`contributes.fileViewers`/`sideTools`) and otherwise inert on the server.

## The roster state machine

A `PluginEntry` (`registry.ts`) is one of `"active" | "disabled" | "failed" | "refused"`. Builtin
entries always have a real id (`registerBuiltin` keys by `module.manifest.id`); external entries
start out either `upsertExternal`-ed (a valid manifest, real id) or `registerRefusedExternal`-ed (an
unreadable/invalid manifest — keyed synthetically as `__refused:<dirname>` since there is no id to
trust). `"refused"` is terminal until `rescan()` sees the directory's manifest turn valid, at which
point the stale `__refused:*` entry for that directory is dropped and a fresh id-keyed entry takes its
place; the reverse (valid → invalid) tears down any live activation and replaces the id-keyed entry
with a fresh refused placeholder the same way. `"failed"` is terminal until `retry(id)` moves it back
to `"disabled"` — `PluginReconciler.schedule()` never retries a failed plugin on its own, so one
plugin's crash cannot turn into a retry storm.

`upsertExternal` on a manifest that has not actually changed (`rescan()` re-discovering an already-active
plugin whose directory is untouched) is a no-op beyond refreshing `dir`: it leaves `module`, `state`, and
`activation` alone. Only a genuinely different manifest drops the stale `module` and resets `state` to
`"disabled"` (clearing any reason) so the reconciler's `entry.state !== "active"` gate actually re-enters
and reimports the module on its next pass — dropping `module` unconditionally, the way this once worked,
left an already-active entry with `state === "active"` and no module, which the reconciler would never
touch again and every RPC to it would answer "Unknown method" from then on.

`PluginReconciler` (`reconciler.ts`) computes, per plugin, `desired = explicit config.plugins[id]?.enabled
?? (builtin ? manifest.enabledByDefault : false)`, ANDed with every dependency being known, not
`failed`/`refused`, and itself desired — computed dependency-first over `registry.topologicalOrder()`
so a dependency's desiredness is already resolved before its dependent reads it. **External plugins
never auto-enable**: an external manifest's `enabledByDefault` is read for builtins only. A dependency
cycle refuses every plugin `topologicalOrder()` could not place (the ones actually in the cycle, and
anything transitively depending on them — the reconciler does not try to guess which member of a cycle
is "the" offending one). Activations walk the topological order forward (dependency-first);
deactivations walk it in reverse (dependent-first). `desired` is a snapshot taken once at the start of
the pass, so the activation loop re-checks each candidate's dependencies against *live* registry state
right before calling `activate()` — a dependency earlier in the same topological order can fail its own
`activate()` mid-pass, and a dependent that was `desired` before that happened must not activate on top
of it; it is marked `"failed"` instead, in the same pass. The roster is republished after every individual
transition, and `seams.resourcesChanged()` fires once per `runOnce()` pass that changed anything.
`schedule()` coalesces overlapping callers into one more pass rather than queuing one run per caller —
a caller mid-pass gets the same in-flight promise, and its `pending` flag guarantees one more full
pass runs before that promise resolves, so a caller's own configuration change is always reflected by
the time its `await` returns.

## Activation-id staleness, drain, and the bounded disposer

Only one activation exists per plugin id at a time; `registry.nextActivationId()` is a monotonic
counter and `PluginHostContext`'s mutating members (`method`, `publish`, `route`, `tool`,
`terminalEnv`, `onTerminal`, `revivePrefill`, `onWorkspace`, `onFsChanged`, `onSettings`) each check
`registry.activationOf(id)?.activationId === <the id captured when this context was built>` before
writing into that activation's tables. A plugin that keeps a `ctx` reference past its own dispose (a
stray timer, a leaked closure) cannot write into a future activation, nor resurrect a dead one — the
check is a live compare against the registry's current activation, not a boolean flipped once. This is
what `activation.test.ts`'s two staleness cases pin: a `publish` called after `deactivate()` reaches no
subscriber, and a `method` registered from a callback that fires after `deactivate()` never appears on
the next `activate()`'s table.

`deactivate()` (`activation.ts`) is three bounded steps: flip state to `"disabled"` immediately (so
`wire.ts`'s dispatch and `serveRoute`'s lookup both start answering "disabled" right away, before
anything async happens), `drain()` the activation's in-flight counter up to `drainTimeoutMs`, then run
the disposer (if any) up to `disposeTimeoutMs` — a timeout logs a warning and moves on rather than
hanging shutdown or a later `rescan()`/`retry()` on one wedged plugin. `drain()` is waiter-based, not
polling: `beginCall`/`endCall` (`registry.ts`) increment/decrement one counter per activation, and a
zero-crossing resolves every queued waiter plus whatever the caller's own `setTimeout` race installed.
`DRAIN_TIMEOUT_MS`/`DISPOSE_TIMEOUT_MS` default to 5000ms; both are overridable parameters on
`deactivate()` so a test can pin them to milliseconds instead of waiting out the real default.

`PluginRuntime.dispose()` (`index.ts`, host shutdown) fires `deactivate()` for every active plugin in
reverse topological order — dependents before dependencies — the same order the reconciler's own
deactivation loop uses, so a dependent's disposer is invoked before its dependency's. Unlike the
reconciler, `dispose()` does not await each `deactivate()` in turn (host shutdown does not wait on
plugins); this is the one sanctioned asymmetry between the two teardown paths. Its residual cost:
because `deactivate()`'s state flip to `"disabled"` is synchronous and every `deactivate()` call in
`dispose()`'s loop is fired without an intervening `await`, every active plugin's state has already
flipped to `"disabled"` before any of their disposers run — so a dependent's disposer calling into its
dependency (`ctx.dependency(dep).request(...)`) still sees `dep` as disabled and gets the usual
`Plugin <dep> is disabled` error, even though its disposer runs first. Reverse order fixes *order of
firing*, not this; closing it fully would need `dispose()` to await each `deactivate()` in sequence,
which the spec deliberately does not require of host shutdown.

## Discovery is a read

`discoverExternalPlugins(roots)` (`discovery.ts`) only ever `readdirSync`s the roots it is handed
(`AppConfig.pluginPaths`) — it never walks a project tree, and a root that does not exist is skipped,
not thrown. It has no memory of its own: every directory under every root is read fresh, and an
unreadable or schema-invalid `thinkrail-plugin.json` becomes a `refused` result rather than being
silently dropped, so a typo'd manifest is visible in the roster instead of invisible. Each entry is
`lstatSync`-ed, not `statSync`-ed: a symlink is refused outright, naming the entry, rather than followed
— the "one scanned directory" trust boundary this module exists to hold would otherwise be one `ln -s`
away from placing an arbitrary directory (a project checkout included) under it. `rescan()`
(`index.ts`) is the only thing that re-runs discovery after boot; boot itself calls it once before the
first `reconciler.schedule()`.

## The external import seam

`external.ts`'s `importExternalHost` — `import(pathToFileURL(entry).href + "?v=" + contentHash)` — is
the **one deliberately bundler-opaque dynamic import in this repo**; `check:binary-seams` allowlists it
by name. The `?v=<hash>` query is a cache-buster (Bun's module cache is keyed by URL, so
a plugin file that changed on disk between two `rescan()`s gets a different URL and is actually
re-evaluated) rather than a version negotiation. `serveExternalFile` resolves a requested subpath
against the plugin's own directory and refuses (404) anything that would escape it — a plugin can
serve its own `web`/`styles`/`assets` files, nothing outside its directory.

**A builtin plugin's `assets` are served too**, through the same `resolveAssetsDir` (`activation.ts`)
that backs `PluginHostContext.assetsDir` — `serveRoute` (`index.ts`) checks `subpath` against the
manifest's declared `assets` prefix for a builtin origin exactly as `isStaticAssetPath` already does for
an external one, resolves the dir (`seams.bundledPluginRuntime(id).assetsDir ?? devBuiltinAssetsDir(id)`,
same as `piResources()` below), and reuses `serveExternalFile` against it with the `assets/` prefix
stripped, so a manifest-only builtin like `plugin-file-icons` needs no host module at all to answer
`/plugin/<id>/<assets>/…` — see `plugin-file-icons/SPEC.md`.

A dynamically-imported file living outside the monorepo's own `node_modules` chain (any real
external-plugin directory, and this module's own test fixtures under a temp dir) cannot resolve a bare
specifier like `typebox` or `@thinkrail/plugin-api` via plain Node ESM resolution — there is no
`node_modules` to find walking up from a temp/plugin directory. The landed answer: an external plugin's
`host.js` (this module's own tests, and the checked-in e2e fixture at `e2e/fixtures/plugin-fixture/`
alike) hand-writes its contract's typebox schemas as plain object literals shaped like typebox's own
wire format (what `Value.Check`/`Value.Errors` accept at runtime), rather than `import`ing typebox
itself — there is no loader-side resolution to add, and no external plugin ships its own
`node_modules`.

binary/desktop, `agent/extensions.ts`'s `bundledPluginRuntime` (injected as a `PluginHostSeams` member
rather than imported directly — this module still does not import `agent`) answers with the
`factories`/`skillsDir`/`assetsDir` `apps/cli/scripts/build-binary.ts` / `apps/desktop/preBuild.ts` staged
from `BuildRuntimeSources.plugins` (`packages/server/src/buildSupport.ts`, itself built from each builtin
plugin package's own `./build-support` module); in dev, where that seam answers the empty runtime, this
module instead `require()`s the plugin package's `./build-support` module directly (`loadBuiltinBuildSupport`)
for its already-resolved absolute extension entry, skills dir, and assets dir, and, when the manifest's
`pi.reachesSubagents` is set, `require()`s the extension entry itself for a real `ExtensionFactory` value
to add to `childFactories` — sanctioned as the one case a builtin plugin's host half is expected to be
reachable this way (`plugin-spec-dialect/SPEC.md`). `devBuiltinAssetsDir()` reuses the same dev `require()`
for `PluginHostContext.assetsDir` (`activation.ts`'s getter: `bundledPluginRuntime(id).assetsDir ??
devBuiltinAssetsDir(id)`), so a builtin plugin's assets resolve the same way in dev, `bun test`, a compiled
binary, and desktop — no plugin needs its own `import.meta.dir` walk (`plugin-claude-code/SPEC.md`).
## `piResources()` — a Stage-4/5 shaped gap, honestly empty for now

`pluginPiResources()` (`piResources.ts`) resolves path-based pi extensions/skills (what pi loads
straight off disk) for every active plugin with a `pi` manifest block — external plugins resolve under
their own directory, builtin ones resolve dev-style against `@thinkrail/plugin-<id>` via
`createRequire`. Its returned `factories: ExtensionFactory[]` — real values, for the compiled
binary/desktop path where there is no file on disk to point at, sourced from
`registerBundledRuntime`'s per-plugin table — is always `[]` here: that table lives in
`agent/extensions.ts`, which this module does not import (out of this module's allowed-import list),
and `BUILTIN_PLUGINS` is empty until Stage 4 gives it something to resolve anyway. Stage 4/5 adds the
seam once a real builtin plugin package exists to test it against; building it speculatively now would
be guessing at a shape nothing yet constrains.

## `PluginRuntime.validateSettings` — the adapter `settings` installs

`settings.ts`'s `PluginNamespaceValidator` seam (`(update, current) => AppConfig["plugins"]`, throwing
on refusal) and this module's `validatePluginNamespaces(update, current, schemaFor)` (returning
`{ namespaces } | { refused }`) are shaped for two different callers — the former is what
`setPluginNamespaceValidator` (`settings/SPEC.md`) accepts, the latter is what this module's own tests
pin. `PluginRuntime.validateSettings` is the adapter: it closes over the registry to build
`schemaFor(id) => registry.get(id)?.module?.contract.settings` and throws `result.refused` rather than
returning it. `host` installs it verbatim: `setPluginNamespaceValidator(plugins.validateSettings)`.
A builtin's `module` (and so its schema) is set at `registerBuiltin` time regardless of activation
state; an external plugin's is set only once its `host.js` has actually been imported (`activate` —
see "The external import seam"), so enabling a never-yet-activated external plugin's namespace for the
first time merges unvalidated, the same "unknown id" fallback `validatePluginNamespaces` already
documents — the schema becomes enforced from its next write onward.

`registry.ts`'s `validateContractIntake(contract)` catches what `definePluginContract` cannot, being a
plain identity function with no runtime check of its own: a `"state"` channel naming a snapshot method
the contract never declares, or a settings schema that shadows the host-owned `enabled` field. It runs
for builtin and external plugins alike, at contract-load time rather than every settings write.

## Tests

Each rule above is pinned by a `bun test` file next to the module it exercises:
`manifest.test.ts` (wire-shape refusal, id≠directory, apiGeneration mismatch naming plugin/declared/
host generation), `discovery.test.ts` (a temp root: valid/unreadable/missing manifest, a nonexistent
root, a symlinked plugin directory refused rather than followed), `registry.test.ts` (roster shape,
dependency order, cycle refusal, contract-intake refusals for an unknown snapshot method and a settings
schema declaring `enabled`, `upsertExternal` leaving an unchanged active plugin alone versus resetting a
genuinely changed one), `activation.test.ts` (activate/deactivate lifecycle, a throwing `activate()`
failing the plugin, the two staleness cases, drain completing before dispose, drain's own bounded
timeout, the disposer's bounded timeout), `reconciler.test.ts` (boot enable, external non-auto-enable,
config disable, cascade-via-dependency, a dependent not activating in the same pass its dependency
fails, failed-not-retried-until-`retry()`, coalesced `schedule()`), `wire.test.ts` (unknown id, unknown
method name on a known plugin, disabled-plugin error, a validation error naming the offending path, a
channel-names listing scoped to active plugins), `settings.test.ts` (two namespaces surviving separate
writes, an invalid namespace refusing the whole update, defaults filled in alongside `enabled`,
`cascadeDisable` reaching transitive dependents without touching an unrelated namespace),
`tools.test.ts` (an `"mcp"`-surface tool validating args before `run`, an `"agent"`-surface tool landing
on a fake `ExtensionAPI`, a tool on one surface not leaking onto the other, a running tool call on either
surface counting toward the activation's drain), `external.test.ts` (the import/serve round trip,
path-containment refusal, 404 for a missing file), and `index.test.ts` (the full `installPlugins`
composition: discovery-then-disabled, config-enables-and-answers-a-method, `serveRoute` serving a
declared static asset, `rescan()` promoting a fixed manifest out of `refused`, `rescan()` leaving an
unchanged active plugin answering, `dispose()` running every active disposer in dependents-first order).
`testFixtures.ts` is shared test-only scaffolding
(`fixtureManifest`/`fixtureContract`/`fixtureModule`/`fixtureSeams`), not part of the module's public
surface.
