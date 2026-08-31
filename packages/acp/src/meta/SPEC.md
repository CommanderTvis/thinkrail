---
id: submodule-acp-meta
type: submodule-design
status: draft
title: meta — the ThinkRail extension namespace
parent: module-acp
depends-on: []
references: [module-pi-agent]
covers: [thinkrail-meta-namespace]
tags: [v1, acp]
---

## Responsibility

The one reserved key ThinkRail writes into ACP's `_meta`, the payloads under it, the `_ext` method names
carrying ThinkRail's pi-only request/response surfaces, and the codecs both ends use.

## Boundary

- **Owns:** `THINKRAIL_META_KEY` (`"dev.thinkrail.v1"`), the `ThinkRailMeta` payload types, the
  read/write/merge codecs, `THINKRAIL_EXTENSION_IDS`, `THINKRAIL_EXT_METHODS`.
- **Public surface (barrel, also the `@thinkrail/acp/meta` subpath):** all of the above plus `MetaBag`.
- **Allowed deps:** none. Deliberately dependency-free — not `@thinkrail/contracts`, not the ACP SDK —
  so `packages/pi-agent` can import it without inheriting a graph.
- **Forbidden:** every sibling; every workspace package; the ACP SDK.

## Decisions

- **One key, versioned in its name.** A single top-level `_meta` key holding one object, not a key per
  signal. A v2 payload becomes `dev.thinkrail.v2` and old readers ignore it — which is the whole reason
  the version is in the key rather than inside the object.
- **Scope is Decision #6's four signals and no more:** attempt-level retry, compaction lifecycle, queue
  depth, true mid-turn steering. `CompactionMeta.supersededMessageId` is part of the compaction signal,
  not a fifth: it names the attempt the agent rebuilt past so the host can annotate it, replacing the
  client deleting a superseded turn from its own copy.
- **Retry is attempt-level because ACP has no sub-turn boundary** — nothing in the protocol expresses
  it. `RetryMeta.scope` exists because a turn countdown and a summarization countdown can run at once
  and are cleared independently. On the compaction side, `reason: "overflow"` is the case that
  supersedes a truncated attempt, and the `summary` an `end` carries is what becomes the transcript's
  compaction marker. `SteerMeta` marks a `session/prompt` sent while a turn is already in flight: an
  agent advertising `steering` routes it instead of rejecting it, and every other agent gets the
  host's held-message emulation.
- **`ThinkRailMeta.extensions` appears only on `InitializeRequest._meta` / `InitializeResponse._meta`,**
  where it says what that end understands.
- **Push signals ride `SessionNotification._meta`** on a no-op `session_info_update` (both fields
  optional, so a conforming client ignores it). They stay ordered against the chunks around them and add
  no method to the protocol.
- **`readThinkRailMeta` never throws and never trusts.** Every field is structurally validated and a
  malformed one dropped: this parses bytes from another process on the hot notification path. It
  returns `undefined` when the key is absent or holds nothing usable. Its two writers are separate on
  purpose: `writeThinkRailMeta` mints a fresh bag carrying only ThinkRail's payload, while
  `mergeThinkRailMeta` adds it to an existing bag and leaves every other key untouched. `MetaBag` is
  any ACP `_meta` bag as the schema declares it — a record, `null` or absent.
- **`_ext` is a second, narrower mechanism, and it is named as one.** Skills listing/toggling and session
  resource reload are request/response surfaces with no `_meta` home. Not an expansion of #6's push list,
  but a second extension channel the decision record should acknowledge. Only the method *names* live
  here — the payload types belong to `@thinkrail/contracts` — so both ends spell the names once.
  Provider login frames deliberately do **not** appear: elicitation plus terminal-hosted auth replaces
  that stream entirely.
