---
id: submodule-server-fs
type: submodule-design
status: active
title: fs — worktree file reads and writes
parent: module-server
depends-on: [module-contracts]
tags: [v1, public-surface-checked]
---

## Responsibility

Read and write directories and UTF-8 files inside a workspace's worktree, path-contained.

## Boundary

- **Owns:** `readDir`/`readFile(workspaceId, path)` — every path resolved + contained to the worktree
  root; `.git` hidden; directories sorted first. (`.thinkrail/` is **not** hidden — it is shown like any
  other dir, so future host-managed content there stays visible; its ephemeral `context/` is kept out of
  git, not out of the tree.) **`resolveWorktreeFile(workspaceId, path)`** returns the
  contained absolute path (same escape guard) for the host to stream a file's raw bytes over HTTP (the
  `/files/…` route serving relative images in the markdown viewer) — this module owns the path safety;
  the host owns the streaming.
- **A write is a compare-and-swap, never a plain write.** `writeFile(workspaceId, path, content, baseHash)`
  reads what is on disk first and refuses when its hash is not the one the editor last read, handing that
  content back instead (`FileWriteResult`). The client merges from there — the host never merges, never
  decides whose text wins, and never writes something the user has not seen. The base is a **content
  hash**, not an mtime or size: a file rewritten to the same bytes is not a conflict, and two writes
  inside one filesystem timestamp tick are. `contentHash` is the one definition of that hash and
  `claudeConfig`'s consented-edit flow uses it too, so a hash handed out by one read is comparable by any
  write. A path with nothing on disk hashes as empty, which is what lets a first write create the file.
- **Public surface (barrel):** `readDir`, `readFile`, `readFileAt`, `writeFile`, `writeFileAt`,
  `contentHash`, `resolveWorktreeFile`.
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (`FileNode`, `FileWriteResult`); Node `fs`/`crypto`/`path`.
- **Forbidden:** `host`; sibling features.
