---
id: module-plugin-branch-graph
type: module-design
status: active
title: plugin-branch-graph — the branch graph as a builtin plugin
parent: module-plugin-api
depends-on: [module-plugin-api, module-contracts, module-plugin-ui]
references: [module-server, module-web]
tags: [v1, plugins]
---

## Responsibility

Owns the Git Graph side tool: the project's branches drawn as commit history, paged and lane-laid-out in the
right rail. Moved from core's `git.graph` wire method and the `panels/GraphPanel.tsx` + `panels/graphLanes.ts`
pair. It ships `enabledByDefault: true` and `dependsOn: []`.

## What moved here, and what stayed in core

- **`packages/server/src/git/git.ts`'s `commitGraph`** — its log parsing and worktree-to-workspace
  matching moved into `host/graphBuild.ts` (`parseGraphLog`, `parseWorktreeList`, `samePathKey`), called
  from `host/index.ts`'s `graph()` through `ctx.git(project.path, …)` (H17) and `ctx.projects()` /
  `ctx.workspaces(projectId)` instead of `project()`/`loadWorkspaces()`. `git.ts` keeps its generic
  helpers (`gitAsync`, `plainText`, the log separator convention) for the features still in core.
- **`GitGraph`/`GitGraphCommit`/`GitGraphWorktree`** — moved from `packages/contracts` into `contracts.ts`
  as typebox schemas plus their `Static` projections. The wire methods are `plugin.branch-graph.graph`
  (params `{ projectId, skip? }`) and `plugin.branch-graph.patch` (params `{ projectId, sha }`, returning
  `{ patch }` via `git format-patch -1 -m <sha> --stdout`). `git.fetchRemotes` (the branch list's Fetch)
  stays core — it is unrelated to drawing history.
- **`panels/GraphPanel.tsx`, `panels/graphLanes.ts`** — moved into `web/`, rewritten against
  `PluginWebContext`: `ctx.request("graph", …)` instead of `getTransport().request("git.graph", …)`, the
  project read through `ctx.useHost((host) => host.contextProjectId)` instead of
  `selectWorkspaceById`/`selectedProjectId`, the re-read trigger through
  `ctx.useHost((host) => host.workspaceRevisions[workspaceId])` instead of the store's
  `fsChangesByWorkspace` tick, and the click-a-commit-to-scope-Changes action through the new
  `PluginWebContext.setDiffScope` (W18) instead of the store's `setDiffScope` action directly —
  `diffScopeByWorkspace` stays store-private state; a plugin's web half cannot reach into `apps/web`'s
  store, so this one capability was added to the context for it.
- **The Graph panel draws the project's branches, and only reads.** `graph` answers for the project;
  `graphLanes.layoutGraph` turns the commit list into lanes the way `git log --graph` does — a lane is
  claimed by the sha it waits for, a commit takes the leftmost lane waiting for it, its first parent
  inherits that lane and the rest open new ones. Lanes stop at eight and the ninth shares the last,
  because this lives in the right rail and a rail cannot widen to fit a busy repository; the layout is a
  pure function with its own unit tests. Each row is a button: clicking a commit points the Changes panel
  at that commit's scope. Right-clicking a commit row opens a context menu with **Copy commit hash**
  (full sha to clipboard) and **Copy patch to clipboard** (`patch` method to clipboard). Nothing here
  mutates a repository.
- **The graph draws the rows you are looking at, and keeps the ones you are not.** A commit row is a
  fixed height, so the scroller is sized by counting rows rather than by building them: only the window
  around the viewport plus a dozen rows of overscan exist in the DOM. Older history is fetched a page at
  a time as the scroll approaches the end (a refresh re-reads in place rather than tearing the list down,
  which would throw the reader back to the top mid-scroll). The lane layout carries state across pages:
  `layoutGraph` hands back the lanes it left open and the next page carries them in.
- **The lane art is measured across the rows on screen, never per row.** Every row shares one gutter
  width; a row is exactly as tall as the SVG it holds. A lane is drawn in halves around its own dot —
  above it only when a child above really continues into it, below it only when the commit has a first
  parent. Every turn is the same quarter of the same circle, so a fan of merges reads as a comb. An
  orphan branch needs no special case: it shares no ancestry, claims a free lane, ends at its own root,
  and frees the lane there. The shared width is the widest row *in view*, not in the whole history, and
  slides between widths instead of jumping.

## Boundary

- **Owns:** `manifest.ts`, `contracts.ts`, `host/` (the `graph` method and its log/worktree parsing),
  `web/` (the Graph panel and its lane layout), `build-support.ts`.
- **Public surface:** `./manifest` (the `manifest` value), `./contracts` (`branchGraphContract`,
  `GitGraph`, `GitGraphCommit`, `GitGraphWorktree`, the schemas), `./host` (default export, a
  `PluginHostModule`), `./web` (default export, a `PluginWebModule`), `./build-support` (`buildSupport`).
- **Allowed deps:** `@thinkrail/plugin-api` (+ `/host`, `/web`), `@thinkrail/contracts`,
  `@thinkrail/plugin-ui`, `@remixicon/react`, `typebox`, `react`.
- **Forbidden:** `@thinkrail/server`, `apps/*`, another plugin's host half, the app's store/transport/
  panels modules.

## Tests

`host/graphBuild.test.ts` pins the log/worktree parsing directly against fixture strings (this package
cannot reuse `packages/server/src/git/git.test.ts`'s real-repo harness, which lives on the other side of
the boundary): sha/parents/refs/subject extraction, control-text stripping, page cropping and `hasMore`,
and worktree-to-workspace pairing. `web/graphLanes.test.ts` moved verbatim (pure lane layout, no context
dependency).

## History

Moved out of core as part of the plugin-api adoption (`plugin-adoption.md`). Before this move,
`packages/server/src/git/SPEC.md` documented `commitGraph` alongside the rest of `git.ts`, and
`apps/web/src/panels/SPEC.md` documented the Graph panel alongside the other panels.
