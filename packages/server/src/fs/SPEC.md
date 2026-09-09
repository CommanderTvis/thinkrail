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

Read and write directories and UTF-8 files inside a workspace's worktree, path-contained, and sweep them
for a substring.

## Boundary

- **Owns:** `readDir`/`readFile(workspaceId, path)` — every path resolved + contained to the worktree
  root; `.git` hidden; directories sorted first. (`.thinkrail/` is **not** hidden — it is shown like any
  other dir, so future host-managed content there stays visible; its ephemeral `context/` is kept out of
  git, not out of the tree.) **`resolveWorktreeFile(workspaceId, path)`** returns the
  contained absolute path (same escape guard) for the host to stream a file's raw bytes over HTTP (the
  `/files/…` route serving relative images in the markdown viewer) — this module owns the path safety;
  the host owns the streaming.
- **An ignored entry is marked, not hidden.** `readDir` asks `git check-ignore` which of the listed
  entries git would ignore and sets `FileNode.gitignored` on them — asking git, not parsing patterns, is
  what makes every rule count: `.gitignore` at any level, `.git/info/exclude`, the global excludes file.
  One `-z --stdin` batch per listing; exit 1 is git's "none", anything higher (a plain folder, no git) marks
  nothing. Build output and scratch dirs stay openable, the tree just says they are not the repo's.
- **A write is a compare-and-swap, never a plain write.** `writeFile(workspaceId, path, content, baseHash)`
  reads what is on disk first and refuses when its hash is not the one the editor last read, handing that
  content back instead (`FileWriteResult`). The client merges from there — the host never merges, never
  decides whose text wins, and never writes something the user has not seen. The base is a **content
  hash**, not an mtime or size: a file rewritten to the same bytes is not a conflict, and two writes
  inside one filesystem timestamp tick are. `contentHash` is the one definition of that hash and
  `claudeConfig`'s consented-edit flow uses it too, so a hash handed out by one read is comparable by any
  write. A path with nothing on disk hashes as empty, which is what lets a first write create the file.
- **`searchWorktree(workspaceId, query)` is a plain substring sweep, deliberately.** It walks the
  worktree from the root, reuses the same `git check-ignore` batch per directory that `readDir` uses (so a
  project with no git simply has nothing ignored and everything is walked), skips `.git`, skips a file over
  512 KB or containing a NUL byte, and matches case-insensitively. It stops at 200 hits and says so
  (`truncated`), which is what keeps a sweep of a large tree bounded without a query language, an index, or
  a ripgrep the user may not have installed. Line text is capped at 400 characters per hit — a minified
  bundle must not travel over the wire as one match.
- **Public surface (barrel):** `readDir`, `readFile`, `readFileAt`, `writeFile`, `writeFileAt`,
  `contentHash`, `resolveWorktreeFile`, `searchWorktree`.
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (`FileNode`, `FileWriteResult`); Node `fs`/`crypto`/`path`.
- **Forbidden:** `host`; sibling features.
