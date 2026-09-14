---
id: module-plugin-spec-dialect
type: module-design
status: active
title: plugin-spec-dialect — the spec-graph dialect as a builtin plugin
parent: module-plugin-api
depends-on: [module-plugin-api, module-contracts, module-shared, module-plugin-ui, module-spec-graph]
references: [module-server, module-web]
tags: [v1, plugins]
---

## Responsibility

The first builtin plugin, and the one every other plugin's move is checked against. Owns everything the
fork's "Specs" feature needs: the `spec.graph` read (moved here from `packages/server/src/spec/specs.ts`,
which now keeps only `projectHasSpecs` — a core, plugin-independent Welcome-screen signal), the seven
`spec_*` agent/MCP tools (adapted from `pi-spec-graph/tools`, whose agent-native registration still runs
through the `pi-spec-graph` extension declared in this plugin's manifest `pi` block — not through this
package), the Specs side-tool panel, and the tree/tool-card presentation that used to live under
`apps/web/src/panels` and `apps/web/src/chat/tools`.

It ships `enabledByDefault: true` and `dependsOn: []`, so a repository with specs looks unchanged to
anyone who never opens Settings — this is deliberate: it is the plugin Blueprint is built on, so the
dependency chain has to start somewhere with zero dependencies of its own.

## What moved here, and what stayed in core

- **`packages/server/src/spec/specs.ts`'s per-workspace `SpecIndex` cache and `specGraph()` mapping** —
  now `host/index.ts`'s `graph()` closure, reading the worktree through `ctx.workspace(id)` +
  `ctx.watchWorkspace(id)` instead of `loadWorkspaces()`, and evicting on `ctx.onWorkspace("removed")`
  instead of a `workspace.remove` handler calling an exported `evictSpecIndex`. `projectHasSpecs` and its
  own, separate, never-evicted `projectIndexes` cache **stay** in `packages/server/src/spec` — the
  Welcome screen's "does this repo have specs" question is about the repository, not about whether this
  plugin happens to be on (see `plugin-adoption.md`).
- **`SpecGraphNode`/`SpecGraphSnapshot`** — moved from `packages/contracts` into `contracts.ts` as typebox
  schemas (`SpecGraphNodeSchema`/`SpecGraphSnapshotSchema`) plus their `Static` projections. The wire
  method that used to be `spec.graph` is now `plugin.spec-dialect.graph`, param `{ workspaceId }`.
- **The seven `spec_*` tools** — `host/index.ts` registers each of `pi-spec-graph/tools`'s `SPEC_TOOLS`
  through `ctx.tool(...)` with `surfaces: ["mcp"]` only. The **agent** surface is not this package's
  concern: it comes from the `pi-spec-graph` pi extension itself, declared (not absorbed) by this
  manifest's `pi.extensions`, exactly as `plugin-api/SPEC.md`'s "Shipping pi extensions and skills"
  describes. `pi-spec-graph` therefore stays a portable, pi-only package, unchanged, and is a direct
  dependency of this plugin package — the one place a builtin plugin is expected to depend on the pi
  package it wraps (`plugin-api/SPEC.md`'s general "no pi package" dependency rule is about an
  *arbitrary* plugin author; this plugin's whole reason to exist is wrapping `pi-spec-graph`).
- **`SpecsPanel`, `specTree`, `SpecToolCard`** — moved into `web/`, rewritten against `PluginWebContext`
  (`ctx.request("graph", …)`, `host.workspaceRevisions[workspaceId]` — the per-workspace fs tick
  `apps/web/src/store/selectors.ts`'s `selectWorkspaceTick` feeds, exposed generically through W3 rather
  than a spec-specific channel — read via `ctx.watchHost` in `activate()` (see "spec.graph ownership"
  below), `ctx.editors.open`, `ctx.useHost`), and owning their own zustand store (`web/store.ts`) instead
  of `useAppStore`. `specDocument.ts`'s `SPEC_TYPES`/`SPEC_ROLES` **stay** in `apps/web/src/panels` (the
  general markdown-preview feature keeps recognizing "this looks like a spec" by frontmatter shape
  alone, independent of this plugin); `web/specTree.ts` keeps its own small copy of the role-label
  table since it cannot reach into `panels/`.
- **`spec.graph` ownership: the fetch is driven from `activate()` (`web/specSync.ts` + `web/index.ts`),
  not `SpecsPanel`.** `SpecsPanel`'s body only exists while the Specs tab is the selected side tool
  (`Workbench.tsx`'s `renderToolBody` swaps a single node), but the `documentLink`/`writtenPathGroup`
  slots below and the chat turn-divider's specs bucket read `useSpecStore`'s `specsByWorkspace`
  regardless of whether that tab has ever been opened. `activate()` calls `ctx.watchHost` on
  `{ workspaceId: host.activeWorkspaceId, revision: host.workspaceRevisions[...] }` (plus one eager call
  against `ctx.host()` for the workspace already active when the plugin activates) instead of mounting a
  component through a registration slot — the same scope the pre-plugin `WorkspaceWorkbench`'s
  unconditional `useWorkspaceSpecs(workspaceId)` call used to guarantee, without borrowing a UI
  contribution point as a mount hook. `SpecsPanel` only reads `specsByWorkspace`/`failedByWorkspace` from
  the store and calls `loadWorkspaceSpecs` directly for its manual retry button; `syncWorkspaceSpecs`
  collapses the duplicate fetches `watchHost` and the panel's own retry could otherwise race into two.
- **The turn-divider "specs" bucket and the `spec:<id>` markdown link** — no longer a core special case.
  `web/index.ts` registers a `documentLink` slot (resolves `spec:<id>` against this plugin's own graph
  state) and a `writtenPathGroup` slot (a written path that matches a node in the graph groups under
  `{ id: "specs", tool: plugin:spec-dialect:specs }`) — the same slot mechanism a `fileIcon` resolver
  would use (W17). Core's chat module keeps zero knowledge of "specs" as a concept; `chat/rows.ts`'s
  `WRITE_TOOLS` set still names `spec_create` literally as one of the tool names whose written path is
  worth tracking at all (a small, intentionally-hardcoded core convention — see `plugin-adoption.md`'s
  open-question list — separate from *which group* that path lands in, which is this plugin's call).

## Boundary

- **Owns:** `manifest.ts`, `contracts.ts`, `host/` (the graph read, workspace-lifecycle eviction, the mcp
  tool table), `web/` (the Specs panel, its tree/tool-card presentation, its own zustand store), and
  `build-support.ts` (the dev-time absolute path to the `pi-spec-graph` extension entry and its skills
  directory, mirroring `packages/server/src/buildSupport.ts`'s shape for the fixed extension list).
- **Public surface:** `./manifest` (the `manifest` value), `./contracts` (`specDialectContract`,
  `SpecGraphNode`, `SpecGraphSnapshot`, the schemas), `./host` (default export, a `PluginHostModule`),
  `./web` (default export, a `PluginWebModule`, plus `specToolPaths` for the one thing a future companion
  might want to reuse), `./build-support` (`buildSupport`).
- **Allowed deps:** `@thinkrail/plugin-api` (+ `/host`, `/web`), `@thinkrail/contracts`,
  `@thinkrail/shared`, `@thinkrail/plugin-ui`, `pi-spec-graph` (`/core`, `/tools`, and its extension
  entry), `typebox`, `zustand`, `react`.
- **Forbidden:** `@thinkrail/server`, `apps/*`, another plugin's host half, the app's store/transport/
  panels/chat modules.

## Tests

`host/index.test.ts` builds a minimal fake `PluginHostContext` (this package cannot reuse
`packages/server/src/plugins/testFixtures.ts`, which lives on the other side of the boundary) and pins:
the graph mapping over a temp worktree, an unknown workspace rejecting the read, and eviction on a
`removed` workspace event swapping in a fresh index rather than serving the stale one.
`web/specTree.test.ts` moved verbatim (pure tree-building logic, no context dependency).

## History

Moved out of core as part of the plugin-api adoption (`plugin-adoption.md`, "The spec dialect,
builtin, first"). Before this move, `packages/server/src/spec/SPEC.md` documented `specGraph` and
`evictSpecIndex` alongside `projectHasSpecs`; that spec is now narrowed to `projectHasSpecs` only.
