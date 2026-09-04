---
id: submodule-server-fs
type: submodule-design
status: active
title: fs — worktree file reads and writes
parent: module-server
depends-on: [module-contracts, module-shared]
tags: [public-surface-checked]
---

## Responsibility

Read and write directories and files inside a workspace's worktree, path-contained, sweep them for a
substring, and decide **what a resource's bytes are** — the one byte-level classification every content
read in the host shares.

## Boundary

- **Owns:** `readDir`/`readFile(workspaceId, path)` — every path resolved + contained to the worktree
  root; `.git` hidden; directories sorted first. (`.thinkrail/` is **not** hidden — it is shown like any
  other dir, so future host-managed content there stays visible; its ephemeral `context/` is kept out of
  git, not out of the tree.) `readFile` answers **`{ content, meta }`**: a file is read as bytes and
  decoded only when it is text, so `content` is `""` for a byte-only resource and the client fetches
  those bytes over the host's `/files` route instead of receiving mojibake.
  **`resolveWorktreeFile(workspaceId, path)`** returns the
  contained absolute path for the host to stream a file's raw bytes over HTTP (the `/files/…` route
  serving relative images in the markdown viewer, the `/blob` route's containment check) and for the
  `changes` module's atomic writes. Lexical escapes, `.git`, and an existing symlink chain whose resolved
  target leaves the worktree are refused; missing leaf paths are allowed so a deleted file can be
  restored. `changes` passes `{ followLeaf: false }` so containment validates through the parent and its
  own `lstat` can reject even an escaping leaf symlink without following it. This module owns the path
  safety; its callers own the streaming and the writing.
  **Content classification** (`content.ts`, pure, no dependency): `CONTENT_SNIFF_BYTES` names the shared
  8 KiB bounded-head size; `classifyBytes(bytes)` → `{ text, mime? }` — **mime** is what the *bytes*
  prove (magic numbers for png/jpeg/gif/webp/avif/bmp/ico/pdf/zip/gzip/woff/woff2, plus `image/svg+xml` for
  text whose root element is `<svg>`, directly or behind an XML prolog — a prolog alone is not an
  image, and `application/vnd.git-lfs` for a text file of at most 1 KiB that is exactly the three-line pointer
  `git lfs` itself writes — `version`, `oid sha256:`, `size`, in that order, nothing else, so no prose
  that merely quotes a pointer can be mistaken for one — so a `.png` whose content is a pointer is
  reported as the pointer it is, not as an image that failed to decode); **text** is "no recognized binary magic number, no NUL byte in the first 8 KiB, and a strict
  UTF-8 decode" (a BOM is text; an SVG is text because `image/svg+xml` is inferred from text, never
  from a magic number). A magic number wins over decodability: an uncompressed PDF is valid ASCII, yet
  it is a document the PDF renderer owns, not source the code renderer may claim; `hashBytes(bytes)` → the sha-256 hex that **is** a
  resource's identity on the wire (`ResourceMeta.hash`, `ReviewAnchor.contentHash`, the `change.*`
  compare-and-swap); `decodeText(bytes)` → the one UTF-8 decode (BOM retained, because the BOM is part
  of the bytes the hash covers); `mimeFromPath(path)` owns the filename fallback no byte inspection can
  give (markdown/json/csv/yaml/html/xhtml/plain); `resourceMeta(bytes, path)` → the wire's **`ResourceMeta`**, adding that
  fallback and treating
  `null` bytes as absence (`hash`/`byteLength` null, `text: true` — nothing to decode, and the empty
  string it pairs with is valid text).
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
  inside one filesystem timestamp tick are. `contentHash` is the one definition of that hash — the same
  sha-256 hex `hashBytes` gives the file's bytes, so the `ResourceMeta.hash` a read handed out is the base a
  write compares — and
  `claudeConfig`'s consented-edit flow uses it too, so a hash handed out by one read is comparable by any
  write. A path with nothing on disk hashes as empty, which is what lets a first write create the file.
  `contentHash`/`readFileAt`/`writeFileAt` themselves live in `@thinkrail/shared/textFile` (path-agnostic:
  no worktree containment) — this module re-exports them and owns `resolveInWorktree`, the containment
  every path here goes through before reaching them.
- **`searchWorktree(workspaceId, query)` is a plain substring sweep, deliberately.** It walks the
  worktree from the root, reuses the same `git check-ignore` batch per directory that `readDir` uses (so a
  project with no git simply has nothing ignored and everything is walked), skips `.git`, skips a file over
  512 KB or containing a NUL byte, and matches case-insensitively. It stops at 200 hits and says so
  (`truncated`), which is what keeps a sweep of a large tree bounded without a query language, an index, or
  a ripgrep the user may not have installed. Line text is capped at 400 characters per hit — a minified
  bundle must not travel over the wire as one match.
- **Public surface (barrel):** `readDir`, `readFile`, `readFileAt`, `writeFile`, `writeFileAt`,
  `contentHash`, `resolveWorktreeFile`, `searchWorktree`, `classifyBytes`,
  `CONTENT_SNIFF_BYTES`, `mimeFromPath`, `hashBytes`, `decodeText`, `resourceMeta`.
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (`FileNode`, `FileWriteResult`, `ResourceMeta`);
  `@thinkrail/shared/textFile`; Node `fs`/`path`/`crypto`.
- **Forbidden:** `host`; sibling features.

## Get right

- **One classification, one hash.** Textness, media type and the sha-256 of a resource are decided here
  and nowhere else: `reviews` captures anchors with them, `git` stamps both diff sides with them, and
  `changes` guards its writes with them. Two implementations would let a comment's `contentHash` and a
  revert's `expect` hash disagree about the same bytes.
- **Extension never beats the bytes.** A `.md` file whose content is a PNG reports `image/png`; the
  filename is consulted only when the bytes say nothing, so a mislabelled resource cannot talk a
  renderer into parsing it as text.
