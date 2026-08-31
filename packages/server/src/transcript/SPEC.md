---
id: submodule-server-transcript
type: submodule-design
status: draft
title: transcript — the host-owned append-only session record
parent: module-server
depends-on: [module-contracts, submodule-server-persistence, submodule-server-trash]
references: [architecture, submodule-server-history, module-acp]
covers: [host-owned-transcript, append-only-log, crash-safe-append, transcript-search-corpus, delete-to-trash, abandoned-tool-repair, compaction-marker, archive-keeps-transcripts]
tags: [v1, acp, transcript]
---

## Responsibility

The **durable record of every conversation ThinkRail hosts**, for every agent. One append-only log per
session under the data dir, plus the fold that turns it into the array `session.getMessages` returns and
the corpus `history` searches.

[[architecture]] Decision #15 in code: ACP's `session/load` and `session/list` are *optional*, so
anything built on the agent's memory would work with some agents and silently vanish with others. Our
own record makes history, cross-project search, prompt recall, jump-to-message, closed-chat reopen and
chat delete behave identically everywhere. It narrows but does not repeal "the agent owns state": the
host still never **recomputes** what the agent reports — it **records** what it is told. It must land
first; `history`, `session.getMessages`, `session.list`, delete and reopen all read it.

## The one structural idea

```
ChatEvent ──ingest──▶ LogEntry[] ──applyEntry──▶ fold (messages, corpus, record)
                           └──append──▶ log.jsonl ──replay──▶ applyEntry
```

`applyEntry` is the **single** state transition. The live path mints entries and applies them;
hydration decodes entries off disk and applies the same function. A reloaded transcript is the same
object graph the live view held **by construction**, which is what retires the "live and reloaded
disagree" bug class the pi path defended against with `sessionRepair`, `buildSessionContext` and the
`compaction_end` supersede hack — all three deleted rather than ported.

**The store consumes `ChatEvent`, the wire's own vocabulary.** There is no `TranscriptEvent`. That is
what makes `ingest` nearly mechanical (each durable event → one entry) and removes a second translation
layer between `packages/acp` and the disk.

## On-disk format

`<dataDir>/transcripts/<sessionDir>/{log.jsonl, meta.json}`. `<sessionDir>` is the session id when it is
a plain safe token, else `~<base64url(id)>` — an ACP `SessionId` is opaque and agent-chosen, so it can
never be trusted as a path segment. A safe token never starts with `~`, so the two namespaces cannot
collide. The directory name is **authoritative for identity** (the host
minted it), so a session whose log and meta are both damaged still lists and still deletes.

**Why JSONL append, not per-message files and not sqlite.** Two facts decide it. **Deletion has to be
recoverable** — `trashFile` exists precisely so "a recoverable action never falls back to unlink", and
only a file-per-session layout can hand the OS trash a self-contained unit; a row `DELETE` in a shared
DB cannot be undone, a DB per session is absurd, and its `-wal`/`-shm` siblings make the trashed unit
ambiguous. And **sqlite's index buys nothing**: search is case-insensitive substring AND, which FTS5
cannot express (it matches tokens and prefixes, so `bern` would stop finding `kubernetes`), and
`getMessages` wants the whole transcript anyway. Per-message files lose on every axis but partial reads.

**Six entry types:** `head` (identity, format version), `msg` (a `ChatMessage` with its content emptied;
a second `msg` for a known id **replaces** it, which is how the agent's authoritative version of a
prompt supersedes the host's optimistic echo — one send never grows a second bubble), `part` (`chunk`
appends a suffix / `block` sets a block at `(messageId, b)`, the position the translator assigned),
`tool` (a field replacement by call id), `patch` (`endedAt`, `superseded`), `state` (`title`, `config`,
`usage`; latest wins). `part` and `tool` are literally the wire's three write modes. Splitting a
message's content out of its seed is what makes a message that arrives complete and one that streams in
produce the *same* entries. A user message carries prompt content only — a `thinking` or `toolCall`
block addressed at one is a translator bug and is dropped rather than stored.

An entry that does not parse, or whose `t` is unknown, is skipped, so a newer host's entry degrades to
noise; block positions are absolute, so the gap a skipped entry leaves is padded with a blank text
block and every later block stays aligned. The log version bumps only for a change an older reader
cannot tolerate — an additive entry type does not bump it.

**The log never rewrites and never renumbers.** pi's session files are trees compaction rewrites, which
is why `history/extract.ts` had to run `parseSessionEntries → migrateSessionEntries →
buildSessionContext` before it could count anything. Ours has no branches, no abandoned entries and no
compaction rewrite. **Text and thinking are stored as suffixes**, so a three-minute message costs its
own bytes, not one copy per flush — that is what makes sub-second durability affordable.

**`meta.json` is a cache, never a source.** `{ v, record, logBytes }`, temp+rename so the target is
never observed half-written, with a per-pid temp name so a second process cannot tread on a rename in
flight. `logBytes` is the watermark: a size that no longer matches the log means rebuild-by-scan, which
also repopulates that session's corpus. While a session is live the cache may lag the log by up to five
seconds; `close`, `flushAll` and `dispose` force it out. It earns its place by making `session.list` an
O(sessions) read of small JSON files instead of the full-corpus parse `SessionManager.listAll()` cost.

## Crash safety

- **Torn last line.** Only the last line can be torn (single writer, one write per flush). `open()`
  truncates to the last complete newline before appending, so a partial record can never fuse with the
  next into something that parses but is wrong. A pure `read()` never truncates.
- **Stale meta.** Detected by the watermark, rebuilt.
- **A turn that never settled.** `repairOnOpen` flips pending tool calls to `abandoned`, closes an
  un-ended assistant message, and appends a `turnSettled` marker with `stopReason: "failed"`. The
  durable replacement for `agent/sessionRepair.ts`, and why a reopened chat never spins forever.
- **Interrupted delete.** The directory is either in place or in the trash; the tombstone is installed
  **before the first await**, so a concurrent read cannot resurrect the chat mid-transaction, and it is
  cleared on failure **only by the transaction that installed it**, so a retry cannot roll back an
  earlier success. Tombstones are in-memory only — the directory is gone, so a restart clears them.

## Streaming → durable

`append()` is **synchronous** — it is called per streamed chunk and must never make a chunk handler
await the disk. Durability is `flush()`. Structural entries go on the next tick; `chunk` parts coalesce
at 16 KiB or 1000 ms, forced by `close`/`delete`/`flush`/`flushAll`. About one write per second per
streaming session, losing at most one second of one message. Writes chain per session so they cannot
interleave, and a failed write is reported to the caller of *that* flush without poisoning later ones.
The appender holds no long-lived descriptor — every flush is one `appendFile` — which keeps deletion
free to move the whole directory on every platform.

**In-flight tool output is deliberately not durable.** Only a terminal patch reaches the log: a call
that never reached a terminal status is marked `abandoned` on reopen, so persisting its partial output
would decorate a corpse — while a command streaming megabytes under REPLACE semantics is the one place
this format would otherwise amplify. That decision removes the amplification problem instead of managing
it. Persisted tool text is capped at 256 KiB per item with `truncated: true`.

## Compaction as an annotation

A `compaction` marker records where the agent reset its context. **An annotation, never a deletion**:
the summarized-away messages stay in the log, stay rendered and stay searchable, because the record
belongs to the user rather than to the agent's context window. `superseded` flags an attempt the agent
rebuilt past without removing it, replacing "delete the superseded turn so live and reloaded agree" —
under this store they agree anyway.

## Read model and residency

`read()` returns `{ record, messages }` — an array, not a replay stream, which keeps hydrate-then-stream
a sequence instead of a merge. `readCorpus(budgetMs)` returns per-session text keyed by `messageId`,
user and assistant only, full and never truncated, hidden and empty messages skipped; it blocks on the
first full load for at most that budget and then reports what it has with `complete: false`.

`append()` hands back the store's **live** message objects: serialize them onto the wire immediately
and never retain them. Nothing else aliases them either — the fold clones every message it takes from a
caller or decodes off disk.

`records` are resident once the directory is listed; `corpus` once a session's log is read; **the full
fold only for open sessions** — `read()` on a closed chat parses, serves and discards, keeping only the
corpus. Memory is bounded by open chat tabs, not by the archive, which matters because one session's
tool output can be tens of megabytes. Opening a session drops its cached corpus copy, which would
otherwise shadow the live fold's; `close()` flushes, refreshes that cache and the meta file, and
releases the fold — the record survives. No LRU, no eviction policy, nothing to tune. There is no
mtime/size revalidation loop: the host is the only writer, so freshness follows from ownership rather
than polling. Only the first corpus load is asynchronous, and it yields between sessions.

## Boundary

- **Owns:** `<dataDir>/transcripts/`; the log format and version; the fold (`applyEntry`, `ingest`,
  `replay`, `deriveCorpus`, `recordOf`, `repairOnOpen`); the appender and its flush policy; the meta
  cache; residency; the corpus; the single-flighted delete-to-trash transaction and its tombstones.
- **Public surface (`index.ts`):** `TranscriptStore` (`open`, `append`, `read`, `list`, `readCorpus`,
  `close`, `delete`, `releaseWorkspace`, `isDeleted`, `flush`, `flushAll`, `dispose`),
  `getTranscriptStore()`, `transcriptsRoot()`, `TranscriptAppendResult`, `OpenTranscriptInput`,
  `TranscriptListFilter`. `open` is idempotent for a session that is already open, and
  `getTranscriptStore()` is the lazy process-wide singleton the session manager and `history` share.
  Test-only builders live in `testFixtures.ts`, reachable only through
  `@thinkrail/server/transcript-test-fixtures` and never re-exported from `index.ts` — they write to
  disk and must never enter the runtime module graph. `writeFixtureTranscript(dataDir, …)` seeds a
  session by **driving this store** — `open` → `append` → `close`, never a hand-written `log.jsonl`,
  so a fixture cannot become a second implementation of the format that drifts from it;
  `openFixtureStore(dataDir)` hands a sibling's tests a store over the same temp dir. `createdAt` is
  the wall clock inside `open()`, so a fixture controls message timestamps but not the record's
  `createdAt`/`updatedAt` — seed in the order you want `list()` to return.
- **Allowed deps:** `@thinkrail/contracts`, `../persistence` (`dataDir`), `../trash` (`trashFile`),
  `node:fs/promises`, `node:path`.
- **Forbidden:** `agent`, `host`, `history`, `workspaces` or any other sibling; an ACP type or a pi
  package; publishing to the wire — `append()` *returns* what changed and `host` decides the frame.

`../trash` is a new leaf module: `agent/trash.ts` moves there unchanged, because this module needs the
OS-trash primitive and `transcript → agent` would be an edge in the wrong direction.

## Consumer changes this lands with

The ACP session manager calls `open`/`append`/`close`/`delete` and keeps only process facts
(`isStreaming`, `live`), composing them with `list()` into `SessionSummary`; `scanSessionFiles`,
`readSessionFileIdentity`, `listSessionInfosStrict`, `purgeDiskSessions`, `repairDanglingToolCalls`, the
cwd disambiguation and the pi tombstone map are deleted — `isDeleted` is the one tombstone. `history`
loses `extract.ts`, `testFixtures.ts`, the `HistoryIndex` class, its singleton and the whole
discovery/revalidation half; `searchHistory()` becomes a pure function over `readCorpus()` and hits
carry `messageId`. `host` installs `flushAll()` on graceful shutdown and passes scope callbacks that now
receive a corpus session carrying `workspaceId`, so the cwd→workspace guess disappears.

## Archiving keeps the record

Archiving a workspace reclaims its worktree and its git state; it does **not** touch its transcripts.
`releaseWorkspace` flushes and closes the sessions that were open, and stops there — the logs stay on
disk, stay listed and stay in the search corpus. This deliberately reverses the pi-era behaviour, where
`purgeDiskSessions` destroyed the agent's sessions for that cwd along with the worktree: that was
defensible while the record belonged to the agent, and is not once it belongs to the user. Archived
chats are readable and searchable but cannot be resumed — there is no worktree to resume into — so the
session manager refuses to reopen one and the client renders it as history.

The one deliberate destructive path remains `delete`, a single session moved to the OS trash, which is
recoverable by construction.

## Accepted costs

Chats started outside ThinkRail leave the search corpus. Archived transcripts accumulate — nothing
reclaims them but an explicit per-chat delete, which is the intended trade for never destroying a
conversation as a side effect of reclaiming disk. Two hosts sharing one data dir is unsupported:
single-writer is assumed by the appender and by the absence of revalidation.

## Later

Log rotation (the `head` entry has room for a `parent` link, so a rotated transcript is a chain read in
order) — out of scope until a real session hurts. Image payload caps; text and tool output are capped,
base64 images are not.
