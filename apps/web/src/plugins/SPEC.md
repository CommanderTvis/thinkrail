---
id: submodule-web-plugins
type: submodule-design
status: draft
title: plugins — the web half of the plugin loader
parent: module-web
depends-on: [module-plugin-api]
references: [submodule-web-store, submodule-web-transport, submodule-web-shell, submodule-web-panels, submodule-web-chat]
tags: [v1, plugins]
---

## Responsibility

Owns the edge between the two children: `registry` is the state a plugin's web half fills in and the
shell/panels/chat read back from; `loader` is the composition root that turns a roster into mounted plugin
web modules. See `packages/plugin-api/SPEC.md` for the W1–W17 capability contract this implements.

## Dependency graph

- `registry` → `@thinkrail/plugin-api` (types), `@thinkrail/contracts`, `zustand`, `react`, `@remixicon/react`.
  **A pure leaf**: no `store`/`transport`/`panels`/`shell`/`chat` import, so any of
  them can read it back without a cycle.
- `loader` → `registry`, `@thinkrail/plugin-api` (`/web`), `store`, `transport`, `chat/toolRegistry`,
  `panels/{openTabs,fileSave,defaultWorkspace,filesUrl,editorEvents}`, `clientPreferences`, `lib`. A
  **composition root**: only `main.tsx` imports it.

## Boundary

- **Owns:** `registry/` (the zustand store every plugin contribution lands in, plus the read selectors
  `shell`/`panels`/`chat` consume) and `loader/` (builtin manifest registration, the external-module
  fetch/refusal/import path, the `PluginWebContext` binding, and the roster→mounted-module reconciler).
- **Public surface:** `registry`'s barrel (store hook + selectors + `pluginIcon`) for every reader;
  `loader`'s barrel exposes only `initPluginLoader()` — nothing else needs a plugin module's internals.
- **Forbidden:** `registry` reaching into `loader`, `store`, or `transport` — every live wire/store edge is
  `loader`'s job, so `registry` stays testable with a fake roster and no app boot.

## Get right

- `selectToolCatalog()` returns **only the plugin-declared entries** (roster order), not the builtin five
  (soon seven) — `shell/layout/model.ts` already owns `BUILTIN_LAYOUT_TOOL_CATALOG` and
  `buildLayoutToolCatalog(extra)` composes the two. Duplicating the builtin rows here would give the tool
  catalog two sources of truth.
- A plugin's declared side tool stays in the catalog, marked `dormant`, whether or not its web module is
  currently mounted — `active` (the loader's per-plugin mount flag) and `roster[].status` (the host's grant)
  both gate it, so a tool never blinks out of the layout after a client-only reload.
- `selectFileViewer(path)` resolves in **registration order**, first eligible entry wins: eligibility is the
  registration's own `matches` predicate when it supplied one, else the manifest's declared
  `extensions`/`names` for that plugin id (read straight off the roster, never re-declared at the call
  site). Core registers its pdf/image/markdown viewers into the same table under the synthetic id `"core"`,
  bypassing `PluginWebContext` (it always supplies `matches` explicitly, so it needs no roster row).

## Settings › Plugins

`panels/PluginsSettings.tsx` (owned by `panels/SPEC.md`'s module, described here since it is this module's
only consumer-facing surface) is the core settings section (`SettingsSection.Plugins`) that manages the
roster: one row per `usePluginRegistry` roster entry — icon (`pluginIcon`), label, version (external plugins only — a builtin ships with the app and its version is the app's), origin badge,
status, a `reason` line for `failed`/`refused` rows, a contribution-count summary, a "Modifies the system
prompt" note when `modifiesSystemPrompt` is set — an `enabled`/`disabled` `SettingsSwitch`, a `Retry` button
on `failed` rows (`plugins.retry`), a `Rescan` button (`plugins.rescan`), and a `pluginPaths` list editor
(add/remove, each change a `settings.update { pluginPaths }`). Every row is its own component
(`PluginRow`, keyed by `entry.id`) so hook counts never vary with the roster.

Enabling and disabling both walk the roster's `dependsOn` edges rather than touching only the one row:
- **Enable** (`pluginsToEnable(id, roster)`): the transitive `dependsOn` closure of `id`, filtered to
  entries whose `status === "disabled"`. Empty → `settings.update { plugins: { [id]: { enabled: true } } }`
  fires immediately; non-empty → a confirm `Dialog` ("Also turn on X, Y?") first, and accepting sends one
  `settings.update` enabling `id` and every listed dependency together.
- **Disable**: fires immediately (the host's `PluginReconciler` cascades dependents off — see
  `packages/server/src/plugins/SPEC.md`); the row shows which currently-enabled plugins depend on it
  (`activeDependents(id, roster)`, the same transitive walk in reverse) as a plain note before the toggle is
  clicked, so the cascade is never a surprise after the fact.

Both walks are pure functions over `PluginRosterEntry[]` (no store/transport reach), exported from
`PluginsSettings.tsx` and unit-tested directly against constructed roster fixtures.
