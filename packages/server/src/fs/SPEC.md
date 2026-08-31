---
id: submodule-server-fs
type: submodule-design
status: active
title: fs — worktree file reads
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

Read and write UTF-8 files inside a workspace's worktree, path-contained.

## Boundary

- **Owns:** `readDir`/`readFile`/`writeFile(workspaceId, path, …)` — every path resolved + contained to
  the worktree root; `.git` hidden; directories sorted first. (`.thinkrail/` is **not** hidden — it is
  shown like any other dir, so future host-managed content there stays visible; its ephemeral
  `context/` is kept out of git, not out of the tree.) **`resolveWorktreeFile(workspaceId, path)`**
  returns the contained absolute path (same escape guard) for the host to stream a file's raw bytes
  over HTTP (the `/files/…` route serving relative images in the markdown viewer) — this module owns
  the path safety; the host owns the streaming.
- **Public surface (barrel):** `readDir`, `readFile`, `writeFile`, `resolveWorktreeFile`.
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (`FileNode`); Node `fs`/`path`.
- **Forbidden:** `host`; sibling features.

## Decisions

- **`writeFile` exists for the agent, not for the UI.** [[architecture]] Decision #18 delegates an ACP
  agent's `fs/write_text_file` to the host so an edit passes through ThinkRail instead of happening out
  of sight; the containment guard is the same one reads use, so an absolute path outside the session's
  worktree is refused rather than written. Parent directories are created because an agent writing a
  new file in a new package is ordinary, and a missing-directory failure would read to the user as the
  host refusing the edit. There is no `fs.writeFile` wire method — nothing in the browser calls this.
