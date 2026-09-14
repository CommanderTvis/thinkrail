---
id: submodule-web-plugins-loader
type: submodule-design
status: draft
title: plugins/loader — mounts plugin web halves
parent: submodule-web-plugins
depends-on: [module-plugin-api, submodule-web-plugins-registry]
tags: [v1, plugins]
---

## Responsibility

The composition root that turns the host's plugin roster into mounted (or dormant) plugin web modules:
builtin manifest registration, the external-module fetch/refusal/import path, the `PluginWebContext`
binding every plugin activates against, and the serialized roster → mounted-module reconciler. Only
`main.tsx` calls into it (`initPluginLoader()`); every other reader goes through `plugins/registry`.

## Boundary

- **Owns:** `builtin.ts` (`BUILTIN_WEB_PLUGINS` — `spec-dialect`, `blueprint`, and `claude-code` since Stage
  4c moved it out of core); `runtimeRegistry.ts` (`installPluginRuntime()` — installs
  `window.__thinkrailPluginRuntime` once, so an external bundle reads `React`/`ReactDOM`/
  `@thinkrail/plugin-api/web`/`@thinkrail/plugin-ui` off `window` instead of bundling its own); `external.ts`
  (`loadExternalWeb(entry)` — fetches `/plugin/<id>/<web>` as text, refuses a bundle that carries its own
  React, else imports it from a blob URL; also owns the plugin's `<link rel=stylesheet>` lifecycle);
  `context.ts` (`createWebContext(entry, activation)` — binds every `PluginWebContext` member to
  `store`/`transport`/`panels` primitives, gated by an `ActivationGuard` so a registration call outside the
  synchronous `activate()` throws; takes the roster entry alone, never the typebox contract — a channel's
  kind/snapshot/key and the plugin's id all come from `entry`, which is what keeps this module out of a
  plugin's typebox dependency; `assetUrl(path)` builds `${httpBase()}/plugin/<id>/<entry.assets>/<path>`
  from the roster entry's own `assets` field the same way `fileUrl` builds a `/files/…` URL, and throws
  when `entry.assets` is `undefined`); `loader.ts` (`initPluginLoader()` + the serialized `reconcile(roster)`
  mount/unmount loop).
- **Public surface (barrel):** `initPluginLoader()` only.
- **Allowed deps:** `plugins/registry`, `@thinkrail/plugin-api` (both entries), `store`, `transport`,
  `chat/toolRegistry`, `panels/{openTabs,fileSave,defaultWorkspace,filesUrl,editorEvents}`,
  `clientPreferences`, `lib`.
- **Forbidden:** nothing outside this module imports `loader/*` directly — a plugin's capabilities reach
  the rest of the app only through what it registered into `registry`.

## Get right

- **A plugin declares its contributions synchronously, during `activate()`.** `ActivationGuard`'s `current`
  flag the loader flips `true` right before calling `activate(ctx)` and `false` right after (in a
  `finally`, so a throwing `activate` still closes the window) — every registration method on the context
  checks it first. This is what makes `removePlugin(id)` in `registry` a complete cleanup: a plugin's whole
  surface exists as of the moment `activate()` returns, so tearing down by id can never miss a registration
  made from some later callback. `ActivationGuard.disposers` is the one exception to "the plugin's own
  returned disposer is the only cleanup": `watchHost` pushes its unsubscribe there instead of handing it
  back to the plugin, since it is a subscription started as a side effect of an `activate()` call rather
  than a registration a plugin must remember to unwind itself — `loader.ts`'s `mount` wraps `disposers`
  around whatever `activate()` returned so both run at `unmount`.
- **`watchHost(selector, listener)` is `useHost`'s non-hook sibling: it fires only when the selected value
  changes.** It rebuilds the same `buildHostProjection` snapshot `host()` returns on every `useAppStore`/
  `usePluginRegistry` write and compares the new selection against the last one with zustand's `shallow`
  (own-key equality, one level deep) rather than `===` — a plain object literal selector (as
  `plugin-spec-dialect`'s `{ workspaceId, revision }` is) would otherwise look "changed" on every store
  write, defeating the point of watching a projection instead of everything. It never fires for the
  selector's initial value; a caller that also needs the value at activation reads `ctx.host()` once
  itself, the way `plugin-spec-dialect/web/index.ts` does.
- **`reconcile` runs from a single serialized queue**, not per-call: `initPluginLoader` chains every
  roster change onto one promise, so an unmount that is still awaiting a plugin's disposer can never race a
  mount for the same id that a rapid enable/disable/enable would otherwise trigger.
- **A failed activation, or a `wireVersion` mismatch, leaves the plugin out of `registry`'s `active`
  set — dormant, not thrown at the caller.** For a builtin plugin the mismatch check compares the
  statically imported `manifest.wireVersion` against the roster row's, before the module is even loaded
  (the manifest is typebox-free and already resident; there's nothing to gain by fetching a bundle that's
  going to stay dormant). An external plugin is trusted as-is: the served web module and the manifest
  that produced the roster row are read from the same plugin directory, so there's no second copy on the
  client to drift from it. `selectToolCatalog` already renders a dormant plugin's declared tools as
  placeholders (see `registry/SPEC.md`), so a broken plugin degrades to an inert tab instead of taking
  `reconcile` down with it and blocking every other plugin's mount.
- **`context.ts`'s `useSettings()`/`host().config` read plugin settings through one `buildConfigProjection`
  function that currently hardcodes `plugins: {}` / `pluginPaths: []`** — the flattened app store doesn't
  carry `AppConfig`'s `plugins`/`pluginPaths` fields yet (that lands with the rest of the store/panels
  integration; see `apps/web/src/store/SPEC.md`). Every plugin reads empty settings until then; wiring the
  real fields in is a one-line change to that one function, not a hunt across every context method.
- **`openTerminal` on a known tabKey attaches instead of no-oping.** `addTerminal` (the store action that
  places and selects a terminal tab, the same one `NewWorkspaceDialog` calls) silently no-ops when its
  `tabKey` already names an entry in `terminalsByWorkspace` — the guard that stops a duplicate reservation
  also stops `openTerminal` from bringing an already-known tab into view. `openTerminal` therefore checks
  `terminalsByWorkspace` first: an unknown `tabKey` goes through `addTerminal` as before (new reservation,
  placed and selected); a known one calls `setActiveTerminalTab` instead, which selects it without touching
  its metadata. `openChat`'s `prompt` option is submitted (`session.prompt`, with the same optimistic
  `appendUserMessage` the rest of the app uses, and an `appendErrorTurn` on failure) rather than staged as
  an unsent draft.
- `subscribe` on a `"state"` channel is snapshot-then-stream: it requests the channel's declared `snapshot`
  method with the caller's scope as params on every subscribe *and* every reconnect (a `connectionGeneration`
  bump while `status === "connected"`), and drops any push whose `key` fields disagree with the scope — a
  scoped subscriber never renders a row it didn't ask for, even if the host briefly broadcasts wider than
  asked.
