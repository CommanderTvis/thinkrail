---
id: submodule-web-transport
type: submodule-design
status: active
title: transport — WS client to the host
parent: module-web
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

The single WebSocket client to the host, its app-wide singleton, and the ordered delivery boundary that
batches high-frequency Pi events without allowing later wire messages to overtake them.

## Boundary

- **Owns:** `transport.ts` (`WsTransport`: id-correlated `request` — replies time out after 60s unless the
  caller raises `timeoutMs`, which a request the host answers *only once a human has* must do (an open
  folder dialog: a fired timeout also drops the reply that follows it) —, the **`?client=` page identity** it
  appends to the socket URL (minted lazily and *not* via the secure-context-only `crypto.randomUUID`, so a
  plain-http remote origin still boots; it spans reconnects but not reloads, correlating replayed requests and
  terminal stream routing while host-owned PTY tabs/shells survive and a reloaded page takes them over by
  durable `tabKey`), **reconnect-safe unresolved requests** — a
  frame that was in flight when its socket died returns to the queue and is replayed under the same request id,
  while the host deduplicates `(clientKey, requestId)`, so an accepted mutation cannot become a false failure or
  execute twice —, the two frames that are this side's half of that bargain — **`{ ack: [id] }` receipts**
  (every response read is acknowledged, batched on a microtask; until one arrives the host must assume the reply
  died with the socket and keep it replayable) and the **`{ resume: [ids] }` reconciliation** sent on every
  (re)connect *before* the replays (the complete still-unresolved set, so the host releases everything else).
  Receipts are deliberately best-effort and never retransmitted — one can die in a socket buffer exactly like a
  response can, and the request it named is already gone from `pending`, so nothing would replay or re-ack it;
  `resume` repairs them all at once by restating the truth rather than confirming the confirmations —, channel
  `subscribe` with last-value replay for snapshots; `terminalData`/`terminalExit`/`terminalDetached`/
  `sessionDeleted`/`agentChanged` are never cached or replayed to late subscribers (append-only terminal data
  and one-shot exit/detach/deletion/invalidation pushes), reconnect/backoff;
  `inferUrl` defaults to
  same-origin; **`httpBase()`** derives the host's HTTP origin
  from the WS `url` — for building host HTTP URLs like the `/files/<workspaceId>/<path>` worktree-file
  endpoint the markdown viewer points relative `<img>`s at, targeting the same host the transport dials); `wireTransport.ts` (`initTransport`/
  `getTransport` singleton; routes `server.welcome`, **`project.updated`**, `chat.event`, `agent.elicitation`,
  `agent.permission`, `session.deleted`, `agent.changed`, `layout.changed`, the
  `workspace.created`/`updated`/`removed` lifecycle trio, `workspace.fsChanged`, `settings.changed`, and
  `review.changed` into the store — and folds every connection transition through
  `setStatus`, whose connected generation gives active-workspace hydration a distinct trigger on every
  reconnect; the complete welcome (protocol + open/recent project views + the negotiated default-agent facts
  + optional config) via the atomic `installWelcomeSnapshot`, whose separate `welcomeGeneration` is the cold-navigation readiness edge;
  project snapshots via `applyProjectUpdated`, `chat.event` via `applyChatEvent(sessionId, event)`,
  `agent.elicitation` via `applyElicitation(push)`, `agent.permission` via `applyPermission(push)`,
  `workspace.created` via `addWorkspace(workspace)`, `workspace.updated` via `updateWorkspace(workspace)`,
  `workspace.removed` via `applyWorkspaceRemoved(projectId, id)`, `session.created` via `noteClosedChats`
  (peer-created domain state enters history only, never local placement), `session.deleted` via the idempotent
  `deleteChat(workspaceId, sessionId)` tombstone fold (an online fast path; because this event channel is
  deliberately not replayed, workbench hydration repairs any deletion missed while disconnected from the next
  authoritative `session.list`), `agent.changed` via the atomic, deliberately data-free store invalidation
  `noteAgentChanged()` — a bare tick bump; unlike the old `provider.changed`, wireTransport does **not** itself
  re-fetch or re-install anything on this channel, because there is no more global model catalog to refresh —
  a consumer (the agent picker, Settings → Agents) reads the tick and re-reads `agent.list`/`agent.providers`/`agent.detect`
  on its own, `layout.changed` via a revision-aware store fold (older or duplicate
  documents are not reinstalled, though their echoed mutation ids still settle matching pending writes;
  mutation ids distinguish this client's acknowledgements from remote commits,
  and the shell layout integration cancels an in-progress pointer draft only for a nonmatching accepted
  revision before rendering it),
  `workspace.fsChanged` via `noteFsChanged(payload)`, and
  **`settings.changed`** via `applyConfig(config)` — the post-startup server-synced app config broadcast;
  welcome config lands in the atomic install above. Before `WsTransport` dispatches any response or non-Pi
  push, `wireTransport` flushes queued Pi events synchronously; connection-status transitions do the same.
  This dispatch barrier preserves cross-message order and the store's transcript-revision fence while still
  collapsing consecutive stream frames. All subscriptions happen once at init, never in component effects);
  `errorText.ts` (**`errorText(err, fallback?)`** — normalizes a rejected `request` (the host's error
  string / a timeout / a thrown non-Error) into a short, display-ready line for a notice/toast);
  `requestError.ts` (**`RequestError`** + **`wsErrorCode(err)`** — a rejection that carries the host's named
  `WsResponse.errorCode`. A coded response rejects with a `RequestError`, everything else (timeout or an unnamed
  host error) with a plain `Error`, so *having* a code is exactly how a caller tells "this
  specific failure" from "the read failed"); `skillLoad.ts` (the one app-integration coordinator for session
  resource loads: single-flight `workspace.watchReady` per workspace; unless the watcher was already known
  ready, fold the conservative `skillChange: "unknown"` wildcard locally as a replay-safe fallback; capture
  the store tick only afterward. Its narrow `prewarmWorkspaceSkillLoad` entry lets a workspace navigator start
  that same preparation before selection without duplicating readiness/fallback policy; failures remain
  retryable by the eventual load. A prewarm preparation is flagged on the wire (`prewarm: true` — the host
  keeps prewarm-only watchers in a bounded, evictable pool) and **never becomes a real load's baseline**:
  the first real load always runs its own real-flagged preparation — answered instantly while the watcher is
  still warm, and re-creating/promoting it (fresh conservative nudge included) when it was evicted — so an
  evicted prewarm can never leave a session on a stale freshness baseline, while prewarms freely ride any
  in-flight preparation and a settled prewarm re-issues (re-warming an evicted watcher on project
  re-selection stays cheap). The wrappers then issue `session.create` / `session.getMessages` /
  `session.reloadResources`, so no call site can accidentally reverse readiness and baseline ordering. The
  `session.getMessages` wrapper also rejects unless the returned `summary.record.workspaceId`/
  `summary.record.sessionId` (`SessionSummary` is composition — `record: SessionRecord` carries the identity
  fields, `SessionSummary` itself wraps it with process facts) exactly match both requested workspace and
  session, making that untrusted-response identity check one shared installation boundary rather than a
  caller convention).
- **Public surface (barrel):** `initTransport`, `getTransport`, `prewarmWorkspaceSkillLoad`, the three
  skill-load-safe session request wrappers, `errorText`, `RequestError`, `wsErrorCode`, `ConnectionStatus`,
  `TransportOptions`.
- **Allowed deps:** `contracts` (method maps, `WS_CHANNELS`, `Project` for welcome + `project.updated`,
  `ChatEventPayload` for `chat.event`, `ElicitationPush` for `agent.elicitation`, `PermissionPush` for
  `agent.permission`, `Workspace` for `workspace.created`/`updated`,
  `WorkspaceRemoved` for `workspace.removed`, `SessionDeletedPayload` for `session.deleted`,
  `WorkspaceFsChangedPayload` for `workspace.fsChanged`, `LayoutChangedPayload` for `layout.changed`,
  `ReviewChangedPayload` for `review.changed`,
  `AppConfig` for `server.welcome`'s config + `settings.changed`, `ServerWelcome` for the welcome payload
  shape including `defaultAgent`/`agentProtocolVersion`); `store`
  (welcome + event routing — a runtime edge owned by the parent graph); `lib` (plain-HTTP-safe random page
  identity); the browser `WebSocket`.
- **Forbidden:** `server`/`shared`/any `pi` package; importing `panels`/`shell`; or requesting, subscribing to, or folding current-layout state. Layout persistence uses only `httpBase()` as part of its frontend-local storage identity.

## What changed under the ACP migration

`pi.event` → `chat.event` (`ChatEventPayload { sessionId, event: ChatEvent }`, folded through
`applyChatEvent` rather than `handlePiEvent`). `pi.extensionUi` is retired outright and **split** into two
new channels with opposite routing shapes: `agent.elicitation` (session-optional — an agent may ask before
any session exists) and `agent.permission` (always session-scoped, inline on the tool card it names, never
a modal). `provider.login` is gone entirely — interactive auth is elicitation or a workspace terminal now.
`provider.changed` is renamed `agent.changed` and its handling gets *simpler*, not just renamed: the old
handler re-read `model.list` and installed it through a provider-version guard because the model catalog
used to be global store state; under ACP config options are per-session (seeded by `session.create`,
kept current by the `config_options` chat event, refreshed by `agent.refreshConfig`), so there is nothing
global left for this channel to refresh — it is purely an invalidation tick for whichever panel cares.
`terminal.tabs` joins `WS_CHANNELS` as a formally-named channel but is still subscribed ad hoc by
`panels/TerminalWorkbench.tsx`, not centrally here, matching `terminal.data`/`terminal.exit`/
`terminal.detached`'s existing pattern (`panels/TerminalInstance.tsx`) — terminal streams are consumed
where the terminal body mounts, not routed through the store.

## Get right

- **`DEFAULT_TIMEOUT_MS` is the ceiling a host-side budget has to fit under, and nothing enforces it.**
  The server bounds network `git` at 55s precisely so its own error — naming the ref, carrying git's
  stderr — wins the race against the causeless `request "…" timed out` this side raises at 60s (issue #209;
  `packages/server/src/git/SPEC.md`). Lower this number below that budget and every stalled fetch silently
  reverts to the generic timeout, with no test or type failing to say so. The two constants live in
  independently-shipped artifacts and are correct by agreement; deriving them from one another belongs in
  `contracts`. Raising a per-request `timeoutMs` is safe, lowering the default is not.
