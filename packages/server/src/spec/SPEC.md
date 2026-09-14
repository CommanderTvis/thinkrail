---
id: submodule-server-spec
type: submodule-design
status: active
title: spec — the repository-level "does this project have specs" signal
parent: module-server
depends-on: [module-contracts]
references: [module-spec-graph, module-plugin-spec-dialect]
tags: [v1, spec-viewer, public-surface-checked]
---

## Responsibility

Answers the project-level **`projectHasSpecs(root)`** — does a repo carry *any durable* spec (any node
whose `type` is not the ephemeral `task-spec`) — which `host` exposes via the **lazy `project.hasSpecs`**
method (a full-tree walk, so requested only for the one project the Welcome screen renders, never eagerly
for every project). This stays a core, plugin-independent signal: the Welcome screen asking whether a
repository carries specs is a question about the repository, and core should not render differently
depending on whether the spec-dialect plugin is switched on (`plugin-adoption.md`).

The read-only Specs *viewer* (the per-workspace spec graph the Specs panel and the `spec_*` agent tools
use) moved to `@thinkrail/plugin-spec-dialect` — see that package's `SPEC.md` for `specGraph`'s new home
and history.

## Boundary

- **Owns:** **`projectHasSpecs(root) → boolean`** — whether a repo **root** (not a worktree) carries any
  **durable** spec (any node whose `type` isn't `task-spec` — an ephemeral scratch task-spec, e.g. under
  `.thinkrail/context/`, must never signal "set up"), through a per-root reused `SpecIndex`; the
  project-level signal behind the Welcome screen's "Set up project" suggestion. Degrades to `false` on a
  glob/parse failure so it can never break `project.open` / `project.list`. `projectIndexes`, the
  per-root `SpecIndex` cache backing it, has no eviction path — a closed/removed project's index is
  retained for the process lifetime, a known gap independent of the plugin split.
- **Public surface (barrel):** `projectHasSpecs`.
- **Allowed deps:** **`pi-spec-graph/core`** (the pi-free read model — the one host-side value-import of
  the extension package outside its own plugin, sanctioned in `module-spec-graph`).
- **Forbidden:** `host`; sibling features; `pi-spec-graph`'s extension entry or `tools/` (pi-coupled); any
  pi package.
