---
id: submodule-server-history
type: submodule-design
status: active
title: history — search over the host-owned transcript corpus
parent: module-server
depends-on: [module-contracts, submodule-server-transcript]
references: [architecture, submodule-server-host]
covers: [prompt-recall, conversation-search, jump-to-message, agent-agnostic-history]
tags: [v1, acp, history]
---

## Responsibility

The `history.search` backend: prompt recall plus full-conversation matches, as **one exported
function** ranking `TranscriptStore.readCorpus()`. No index, no file discovery, no `(mtime, size)`
revalidation, no singleton, no cold-build budget of its own.

All of that existed because the corpus used to live in **pi's** session files: a foreign, per-cwd
directory layout the host had to enumerate, `stat`, re-read and re-resolve (`parseSessionEntries` →
`migrateSessionEntries` → `buildSessionContext`) because compaction rewrote those trees behind our
back. [[submodule-server-transcript]] owns that corpus now, is the only writer of it, and hands it
over already derived — so freshness follows from ownership instead of polling, and the whole
discovery half of this module (`extract.ts`, `historyIndex.ts`, `HistoryIndex`, its singleton, its
disk-writing `testFixtures.ts`) is **deleted rather than ported**. What is left is ranking.

## Hits are identified, not counted

A hit carries **`messageId`, copied straight from the corpus entry**. The old `messageIndex` was a
position in the *resolved* message list, so two independent implementations — this module's extractor
and the client's hydrate — had to agree on that resolution exactly: it is why the extractor consumed
an index slot for a control message before skipping it, and why a superseded retry attempt had to be
skipped rather than filtered. The log never renumbers and the host mints the ids, so a jump now
anchors on identity and that entire class of drift is gone. `anchorText` (the first 120 characters)
survives only as the client's cheap sanity check.

## Matching

Case-insensitive substring **AND** over whitespace-split terms. Query length and result `limit` are
clamped to the protocol caps (`MAX_HISTORY_QUERY_LENGTH` / `MAX_HISTORY_LIMIT`) **here and only
here** — the handler passes them through unclamped. Strict recency order; prompts deduped by
normalized text keeping the newest; the page is capped but the totals are pre-cap. `indexing` mirrors
`TranscriptCorpusSnapshot.complete`, so a client polling a host whose first corpus load is still
running keeps its read-your-writes retry loop.

The two sections split by role: **prompts** are the user entries, **messages** the assistant ones and
only when the query is non-empty. A user-role message hit would be a textual duplicate of its own
prompt entry, adding a location and no text — that location rides on the prompt hit instead
(`messageId` + `anchorText` are on `PromptHit` too). Entry text is **full, never truncated**: a hit's
`text` is what recall inserts into the composer and what the overlay previews, so a cap would
silently corrupt recall of a long pasted-log prompt and make terms past the cutoff unsearchable. The
`snippet` on a message hit is the windowed view, never the stored one.

What is searchable is exactly what the corpus contains — user and assistant text, hidden and empty
messages already dropped by [[submodule-server-transcript]]. Tool output, thinking and markers are
not indexed (V1).

## Scope is injected, as a whole corpus session

`includes(session)` decides membership and `projectOf(session)` supplies the one label the corpus
cannot: both receive the whole `TranscriptCorpusSession`. `workspaceId` is **on** that session, so a
hit's `workspaceId` is copied from the transcript and the old cwd→workspace path guess disappears
along with the `filter(cwd, sessionId)` / `labels(cwd)` pair. This module still knows nothing about
projects or workspaces; `host` builds both callbacks from its registries at the `history.search`
handler.

`scope: "all"` is now exactly "every transcript this host recorded" — an owner-scoped host with no
multi-tenant isolation to preserve, and no longer a window onto agent sessions started outside
ThinkRail, because those never enter the corpus.

## Boundary

- **Owns:** hit ranking — term matching, snippet windowing, limit/query clamping, prompt dedupe,
  ordering, section split and totals.
- **Public surface (`index.ts`):** `searchHistory(input, store?)` and `SearchHistoryInput`. The
  `store` argument defaults to the process-wide `getTranscriptStore()`; tests pass one built over a
  temp data dir with `@thinkrail/server/transcript-test-fixtures`. No test helpers ship from here —
  this module writes nothing to disk at all.
- **Allowed deps:** `@thinkrail/contracts`, `../transcript` **through its barrel**
  (`getTranscriptStore`, `TranscriptStore`).
- **Forbidden:** any pi package or ACP type; `projects` / `workspaces` / `agent` / `host`; reading or
  writing the filesystem itself — the corpus arrives from the store, and this module never touches a
  path.

## Accepted costs

A chat started outside ThinkRail cannot be found, because it is not in our transcript ([[architecture]]
Decision #15 states the trade). Ranking is a linear scan over resident corpus text on the event loop:
that is the same shape as before, minus the per-search `readdir`/`stat` walk, and it stays honest
while the corpus is the size one owner's chat history can reach. If it ever stops being honest, the
fix belongs in the store (which owns residency), not in a second index here.
