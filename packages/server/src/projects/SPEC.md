---
id: submodule-server-projects
type: submodule-design
status: active
title: projects — git repos as projects
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

Keep one stable registry of known git repositories, expose its open and recent views, and open/close a
project without breaking its workspace identity. For a folder that is not a repo yet, classify it and
bootstrap it into one so it can be opened.

## Boundary

- **Owns:** validate a path is a repo (`git rev-parse --show-toplevel`), dedupe by root, assign a stable
  unique readable `slug`; `getProjects` (all known records, with slug backfill), `listProjects` (open
  records only, by `lastOpened`), and `listRecentProjects` (open + closed, by `lastOpened`). A persisted
  optional **`Project.closed: true`** is the entire membership state: absence means open, so existing
  records migrate as open. **`openProject`** finds a known root even when closed, clears `closed`, bumps
  `lastOpened`, preserves its id, persists, and publishes the full snapshot; **`closeProject`** marks that
  same record closed and publishes it without deleting the project, repository, workspace records, or
  live runtimes. **One cwd, one ThinkRail identity:** `openProject` rejects a root already held as some
  workspace's `worktreePath` — a chat's cwd is what an agent is pointed at and what its worktree-scoped
  reads and terminals are contained to, so a second identity on an owned folder would hand one
  workspace's directory to another's chats and reclaim it out from under them.
  Compared **canonically** (a managed worktree's stored path is composed, `--show-toplevel` answers
  symlink-resolved) and only **after** the reopen above, whose own Default workspace legitimately holds the
  project folder. The workspace-side half of the same door is `openExistingWorktree`
  ([[submodule-server-workspaces]]); reading the workspace records for it stays within the `persistence`
  dep — this module still never imports its sibling. `setProjectPublisher` is the host-injected push seam; this module never imports `host`.
  It also owns **`inspectProjectPath`** (classify a path — `repo` / `initable` / `missing` /
  `notDirectory` — so the UI picks between opening, an init offer, or an error) and **`initProject`**
  (bootstrap a plain directory: `git init` + `git add -A` + an **allow-empty** initial commit — committing
  the folder's contents, or an empty commit when it is empty, so the repo gets a HEAD and `git worktree
  add` works; an already-a-repo path short-circuits to `openProject`; a missing / non-dir path throws).
  The commit supplies a **fallback `user.name`/`user.email` only for a field git has none configured for**,
  so a real global identity is never overridden. ("Does the project have specs?" is **not** computed here
  — `host` answers the lazy `project.hasSpecs` query via `spec.projectHasSpecs`, keeping this module free
  of any spec dependency.)
  It also owns the project's **agent override**: `setProjectAgent(id, agentId | null)` writes
  `Project.agentId`, the per-project half of [[architecture]] Decision #15's "global default +
  per-project override" (`null` clears it, falling back to `AppConfig.defaultAgentId`). The id is stored
  **opaquely and never validated here** — `agent` resolves it against the installed catalog at the moment
  a chat uses it, and a configured-but-missing agent is a loud `UnknownAgentError` there rather than a
  silent re-point at a different model and a different bill ([[submodule-server-agent]]). Like every other
  mutation here it publishes the full project snapshot.
- **Public surface (barrel):** `openProject`, `listProjects`, `listRecentProjects`, `closeProject`,
  `getProjects`, `setProjectPublisher`, `setProjectAgent`, `inspectProjectPath`, `initProject`.
- **Allowed deps:** `persistence`; the `git` sub-module (shared `git()` runner, which now owns the
  environment its children spawn under — this module passes none); `contracts` (`Project`, `ProjectPathStatus`); Node/Bun.
- **Forbidden:** `host`; sibling features other than `git` (`workspaces` depends on `projects`, never the
  reverse).
