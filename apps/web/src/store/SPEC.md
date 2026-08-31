---
id: submodule-web-store
type: submodule-design
status: active
title: store — Zustand app state
parent: module-web
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

The single Zustand store: connection status, projects/workspaces, accepted host-synchronized workbench
snapshots plus device-local attention, terminal catalogs, and one **per-session chat runtime** for every live
ACP session (so several chats stream concurrently).

## Boundary

- **Owns:** `appStore.ts` — connection/projects/workspaces state + setters. Connection state has two
  monotonic edges with different meanings: `setStatus("connected")` advances **`connectionGeneration`**
  for reconnect hydration, while **`welcomeGeneration`** advances only when one complete
  `server.welcome` snapshot lands. **`installWelcomeSnapshot(protocolVersion, projects, recentProjects,
  defaultAgent, agentProtocolVersion, config?)`** installs protocol + both sorted project views +
  the welcome's agent facts (`defaultAgent: AgentDescriptor | null` — the agent a new chat starts on
  absent a project override, `null` meaning the host has no usable agent at all, which is the Welcome
  screen's "install an agent" fork; `agentProtocolVersion: number | null` — the ACP version negotiated
  with that agent, so a capability gap can be attributed to the agent rather than the host) + optional
  config + navigation repair and then advances that readiness edge in one Zustand write; route validation
  never observes a protocol-only or project-only intermediate state. `installProjectSnapshot` remains the
  project-only primitive for focused callers. **`projects`** is the open rail, while **`recentProjects`** is the last-opened-ordered set of every
  known open + closed project. **`applyProjectUpdated(project)`** is the one full-snapshot updater for
  `project.updated` pushes and authoritative project-mutation responses: it upserts/sorts Recents and either
  upserts/sorts the rail or removes the row when `closed === true`. Both actions reconcile stale navigation
  too: only when this client's selected project or active workspace belongs to a record no longer open,
  they clear the active workspace and select the first remaining project's Home (or `null` when none
  remain), while deliberately retaining every local workspace view/attention/resource-render/terminal/session
  map for lossless reopen. Other-client opens never steal navigation, and a background close never moves it.
  All project response call sites use the same updater, so the open and recent copies cannot drift.
  Explicit local transitions are **`selectMain()`**, **`selectProject(projectId, opts?)`**, and
  **`activateWorkspace(workspace)`**; each updates its coupled scope ids atomically, and there is no generic
  active-workspace setter that can split the invariant. **`workspaceSelectionHistory: string[]`** is this
  page's most-recent-first workspace attention: every ordinary, route-driven, and history-search activation
  moves its destination to the front, while project/main selection leaves the recency intact. It is not host
  state, URL history, or reload persistence. **`expandedProjectIds: Record<string, true>`** is the
  Projects rail's per-browser expansion — store-held (it must survive the rail's remounts and be writable by
  non-rail gestures) with **`toggleProjectExpanded(projectId)`** (the chevron), **`expandProject(projectId)`**
  (idempotent reveal: workspace creation / worktree attach / the active-workspace visibility rule), and
  `selectProject`'s **`{ reveal: true }`** option — the user-gesture variant that enters a project's home and
  expands its row in one write (rail row click, Welcome-screen open adoption); navigation restore and the
  workspace-removal fallback call it bare, staying expansion-neutral. Project-snapshot installs prune
  expansion to the open rail (a closed project's entry drops; identity-stable when unchanged).
  **`hydrateExpandedProjects(projectIds)`** seeds the set at boot from the `panels/projectExpansion`
  persistence module — the store itself still touches no storage: that module owns the localStorage
  mirror (host-qualified key, best-effort writes, untrusted reads) and subscribes to changes. Validated route restoration uses
  **`activateWorkspaceFromRoute(workspace, sessionId?)`**: it applies the same scope ids, advances the
  compatibility workspace navigation tick plus the current destination-group clock, and either installs a
  transient **`routeChatTarget`** stamped with both clocks or clears an older exact target. A workspace-only
  route carries no center-tab intent, so it retains existing browser-local attention; ordinary location
  derivation may then canonicalize it to an already-selected chat. **`routeChatTargetGeneration`** advances
  only on target installation (including same-workspace deep links), so consumption cannot duplicate the
  shell reconciliation pass. `selectCurrentRouteChatTarget` is the one check that the target's workspace and
  navigation stamp still hold. The shell's chat-reconciliation module validates/hydrates that exact target
  before ordinary locally placed-chat hydration; successful authoritative absence consumes it, while failures
  retain it for reconnect.
  The store owns no URL/history/storage access — `navigation` owns serialization and drivers. It also owns
  the **workspace lifecycle reactions** every client runs
  identically on the `workspace.created`/`updated`/`removed` pushes (no per-client optimism — the backend
  is authoritative): **`addWorkspace(ws)`** upserts a
  `workspace.created` snapshot by `id` (no-op if the project isn't listed yet — reconciles on its next
  `workspace.list` rather than seeding a partial one-row list; else add-if-absent / merge-if-present,
  idempotent with the creating client's own post-create re-list); **`updateWorkspace(ws)`** folds a
  `workspace.updated` snapshot in: **replace** the record by `id` in `workspaces[ws.projectId]`, carrying
  over only the list-computed `diffStats` aggregate (the snapshot is the persisted record, which has none).
  The push is authoritative, so a *replace* — never a merge: a merge could not clear an **optional field the
  host dropped** (`diffBase` re-pointed back to the creation base, the last `skillOverrides` entry removed),
  leaving the client labelling and keying reads off a value the host no longer has; a project never fetched or an id absent from its list is a **no-op** — the next
  `workspace.list` reconciles; **`applyWorkspaceRemoved(projectId, id)`** is the **entire** removal
  reaction (`removeWorkspace` drops the row + `clearWorkspaceState` drops its
  local view/attention/terminal maps and chat runtimes + recency drops the dead id,
  and **if it was this client's active workspace** → activate the most recently selected loaded workspace
  whose project remains open, even across projects; when none remains, `selectProject(projectId)` falls back
  to the removed workspace's Project Home; either active fallback gets the same neutral toast that reads right
  for both the initiator and an observer). A background removal never moves focus. Because the lifecycle event
  is shared but selection history is browser-local, each observing client restores its own prior context. The
  primitive **`removeWorkspace(projectId, id)`** just drops the row (unknown project/id is a no-op);
  **frontend-local workbench state** — one `workbenchFrame` carries the resource-free topology, geometry,
  singleton tools, and restore targets for this frontend surface; `workspaceViewsByWorkspace` carries each
  workspace's resource placements, order, and preview identities; `layoutAttentionByWorkspace` carries its
  selection, last focus, and navigation clocks; and local preset/limit preferences sit beside the frame.
  These are web-local types from `shell/layout`, not wire snapshots. `layoutDocumentsByWorkspace` is an
  identity-stable **derived projection cache** rebuilt only from frame + view for existing selectors/effects;
  it is neither persisted nor writable as authority. There is no accepted/projected pair, revision, mutation
  id, pending write, rollback queue, or conflict state.

  `applyLocalLayoutTransition(result)` is the one atomic installation boundary for pure layout results. A
  resource-only result updates one workspace view and attention. A frame result replaces the singular frame
  together with every retained workspace-view remap, so an explicit group removal or preset application can
  never leave a hidden workspace referencing a dead group. Components never splice group/tab arrays. Empty
  groups are valid frame state and closing a final resource does not delete them. `layoutProjectionEpoch`
  advances only when a local transition invalidates an uncontrolled pointer/resize draft.

  The store owns values and actions, never persistence. `shell/layoutState` validates and hydrates one
  endpoint/surface-qualified local document, subscribes to relevant state edges, and persists the normalized
  frame/views/attention/preferences. `hydrateLocalLayoutState` installs that document once; a missing or invalid
  document is represented by a Balanced frame with no workspace views. `clearWorkspaceTabs` removes the
  workspace view, attention, and associated local state when the workspace disappears. A page-lifetime
  `removedWorkspaceIds` tombstone rejects stale catalog/session/cache/workspace arrivals so an in-flight read
  cannot recreate it.

  **Browser-local resource render state** is keyed by workspace + canonical resource id, never embedded in
  the frame. Loaded file/diff content and ticks, editor modes, live chat runtimes, and resolved document
  markdown remain caches over their domain sources. Placement ids are stable within a workspace view; an id
  already owned by another semantic cache gets a collision-safe cache id. A virtual document is legal only
  when its local resource reference names a registered resolver plus durable source identity; `todo-plan`
  resolves by session to the live `PlanPane`. Arbitrary inline markdown cannot enter persisted layout state.
  An empty pre-hydration cache is never absence: a domain read must be authoritative for the current connection
  generation before reconciliation may prune a local reference.

  **Device-local layout attention** is separate: selected tab per stable group, last-focused center group,
  last-focused group per auxiliary region (left/right/bottom), and per-group navigation clocks keyed by
  host/workspace. Selection/focus
  mutations never alter or publish
  the shared document. Installing a structural snapshot reconciles attention deterministically to the nearest
  surviving tab/group. Navigation clocks advance at request time for every local focus-changing open and
  for an explicit re-selection of the already-active center tab (that click still supersedes older work); that
  stamp travels with the layout intent, so accepting the resulting open/select never increments the same
  group a second time. If structural reconciliation removed the stamped group, the completion reroutes and
  advances its surviving destination exactly once. A slow preview completion is discarded if a newer
  navigation overtook it. Preview identity itself is structural
  and shared per center group; `preview` replaces only that group's slot, while `keep` promotes it one-way.
  A coalesced preview→keep gesture carries `claimPreview` on its single final open intent so the kept tab
  replaces that slot without publishing an intermediate structural snapshot.
  Arrangement-agnostic open intents enter the store, but only the shell layout integration resolves them
  against local last focus and commits placement. `syncLegacySelection` mirrors the selected workbench
  resource into the temporary file/chat/terminal render-cache projection without incrementing navigation,
  atomically clearing the incompatible editor/terminal mirror (and clearing both while the selected resource
  has no cache yet); its reactive selector returns the matched cache/catalog key (not only a readiness
  boolean), so replacing a canonical cache id with a stable shared placement id retriggers the mirror.
  this keeps migration-era feature selectors coherent after initial or remote hydration without making cache
  state a second placement authority. Reopening an existing canonical resource changes attention
  only unless its non-identity metadata changed; for example, a session-info title update updates a queued open in place
  (retargeting a cache alias to the stable placement id when needed) or emits a non-activating refresh for an
  actually placed chat. A structurally accepted close is never undone
  by a late title event; that event instead repairs the retained cache/history label without stealing focus.

  **`terminalsByWorkspace` remains a mirror of terminal domain state, never placement authority.** The host
  owns terminal existence and keys shells by `(workspaceId, tabKey)`; the layout snapshot merely references a
  tab key at one eligible location. `setWorkspaceTerminals` adopts `terminal.list` / `terminal.tabs`, retaining
  an omitted local tab only while its host-catalog reservation is in flight. `addTerminal` mints a durable key
  — or, given an optional trailing `requestedTabKey`, reuses one the host already minted elsewhere
  (`panels/SPEC.md`'s `AgentProviderSetup` paragraph: an `agent.authenticate` `"terminal"` outcome places the
  exact login shell the host opened, the same `ToolOutput.terminal` convention that `terminalId` *is* the tab
  key) — and emits one placement intent (it never edits topology itself): a captured group destination
  preserves contextual Group Header creation, while an uncaptured request resolves to bottom. An optional
  caller key makes the one first-workspace seed idempotent across clients; duplicate local requests for that
  key are a no-op. The parent shell reserves that key without a process before intent consumption. The
  initial-workspace request may then establish a hidden placement without revealing, unfolding, or attaching
  it; attach waits for the visibility gate and consumes any initial command only for a newly created shell.
  A failed same-generation reservation atomically rejects both the pending mirror and its placement intent.
  Confirmed
  close removes the domain tab and queues a resource-removal intent; the shell layout integration prunes
  every stale placement through the next whole-document commit. A stale layout reference never reattaches or
  recreates an absent catalog entry. There is no workspace-global
  `activeTerminal`: each browser's selected tab per group decides which terminal body mounts, while the host's
  existing exclusive attach/takeover contract decides which client controls a given PTY.

  **The per-session chat state — `sessions: Record<sessionId, SessionRuntime>` — is the ACP redesign's
  center of gravity, and it is deliberately thin.** Under pi the store had to *reconstruct* a turn model from
  a stream of low-level deltas (assemble assistant messages from partials, splice out superseded retries,
  synthesize a "✓ Done" / error / truncation closer, track a side table of tool results and another of ask
  answers, fold extension-UI dialog kinds). Under ACP the wire already carries the render-ready shape:
  `ChatEvent` is *simultaneously* the push frame, the transcript store's input, and this reducer's input
  ([[module-contracts]]), so `SessionRuntime.messages: ChatMessage[]` is not derived from the protocol — it
  *is* the protocol's own transcript, folded in place. A `ToolCallBlock` carries its own status/output/error,
  so there is no side `toolResults` table; a `QuestionAnswersMarker` lands in `messages` like any other
  marker, so there is no side `askAnswers` table; a superseded retry gets `AssistantMessage.superseded =
  true` rather than being spliced out, so there is no `attemptAssistantId` bookkeeping; a settled turn's
  outcome (success, refusal, truncation, error) arrives pre-rendered as a `MarkerMessage<TurnSettledMarker>`
  the reducer simply appends, so the store never classifies "was this a failure" itself. The pure
  **`reduceChatEvent(rt, event)`** implements exactly the wire's three write modes plus message/turn
  lifecycle: `message_start` **upserts** by `ChatMessage.id` (append if new, replace in place if known —
  the one rule that covers the composer's optimistic echo, its later replacement by the host's own record,
  and any agent-side rewrite, with no text-matching or skill-echo heuristic); `chunk` appends `delta` onto
  the `TextBlock`/`ThinkingBlock` at `(messageId, index)`, creating it if absent; `block` **sets** the whole
  block at that index (image/resource/toolCall — these arrive complete); `tool_call_update` **replaces** the
  named fields (and `output` wholesale) on the matching `ToolCallBlock`, found by scanning for its
  `toolCallId` — no id→message index is kept because a transcript is short enough that the scan is cheap and
  keeping one is one more thing to invalidate. `turn_start` sets `isStreaming`; `turn_settled` appends its
  marker message **and** clears `isStreaming` plus every retry countdown plus the compaction-in-progress
  flag in the same write — one event, one terminal fact, matching [[architecture]]'s "no attempt-level
  boundary" invariant. `message_end` / `message_superseded` patch the named `AssistantMessage` by id.
  `config_options` / `commands` / `usage` / `plan` / `capabilities` / `agent_status` each replace their
  named field wholesale (all are republish-whole-set semantics on the wire, never patches). `session_info`
  is a **no-op inside the pure reducer** — its `title` instead renames the chat tab (see below), because
  that lives outside a session runtime; misreading this silently drops a title update, so it is the one
  hazard worth a pointer here rather than in code. `retry_scheduled` / `retry_cleared` write/clear one
  `RetryScope` (`turn` | `summarization`) key of `retries`, so the two flows never clear each other.
  `compaction_start` / `compaction_end` only drive the ephemeral `compacting: CompactionReason | null`
  progress flag — the durable outcome is the separate `CompactionMarker` message the host appends via its
  own `message_start`, so the reducer does not synthesize a "done"/"failed" record here; a compaction that
  fails and kills the turn is explained by that turn's own `TurnSettledMarker.error` instead.
  `queue_changed` replaces `queue: { steering, followUp }`. **`applyChatEvent(sessionId, event)`** is the
  *only* per-session mutator that consumes `ChatEvent` — it special-cases `session_info` (renaming the tab;
  see `renameChatTab`, ported unchanged in mechanics from the old `applyExtUi`'s `setTitle` case, now
  triggered by a different event shape) and otherwise folds through `reduceChatEvent` via `withRuntime`
  (a no-op for an unknown session id). It replaces `handlePiEvent`; there is no longer a distinct
  `appendUserMessage`, because the composer's optimistic echo is just a locally-built `ChatMessage` fed
  through the exact same `{ type: "message_start", message }` event — one write path, not two. The one
  legitimate case of the client fabricating a transcript entry the host never saw — a rejected
  `session.prompt`/`steer`/`followUp` call — goes through **`appendNotice(sessionId, level, text)`**, which
  appends a client-synthesized `MarkerMessage<NoticeMarker>` (`level: "error"` for a failed send); this
  replaces `appendErrorTurn`.

  **Elicitation is one global, session-agnostic modal queue — not per-session state** — because
  `ElicitationRequest.sessionId` is *optional* (an agent may ask before any chat exists, during auth or
  provider setup) and the UI contract is "rendered as the modal dialog: one at a time, with a FIFO queue
  behind it" ([[module-contracts]]) app-wide, not per chat. **`activeElicitation: ElicitationRequest |
  null`** + **`elicitationQueue: ElicitationRequest[]`** live on `AppState` directly; **`applyElicitation(push)`**
  folds an inbound `ElicitationPush` (`request` queues behind a busy dialog or becomes active; `cancel`
  drops the named request from wherever it sits — active promotes the next queued one, queued just filters)
  and **`clearActiveElicitation(id)`** is the optimistic "I just answered" drop (id-checked, so a stale clear
  racing a newer dialog is a no-op) called once `agent.answerElicitation` is dispatched. **Permission is the
  opposite shape — per-session, per-tool-call, and never a modal**, because it "renders inline on the tool
  card it names" ([[module-contracts]]): each `SessionRuntime` carries **`permissions: Record<ToolCallId,
  PermissionRequest>`**, folded by **`applyPermission(push)`** (`request` is `sessionId`-routed and keyed by
  `toolCallId`; `cancel` carries only a `PermissionRequest.id` with **no** `sessionId` on the wire, so it
  scans every open session's `permissions` for the matching entry — small and correct, since the wire gives
  no session hint to route by) and cleared by **`clearPermission(sessionId, toolCallId)`** the instant
  `session.answerPermission` is dispatched, mirroring the elicitation optimistic-clear.

  **Config options (model / thinking-level / mode pickers) are session-scoped state now, not a global
  catalog** — `agent.refreshConfig` takes a `sessionId` and `ConfigOption[]` is what `session.create` /
  `session.getMessages` / `session.setConfigOption` all answer, so there is no more global `models` list,
  `providerVersion` guard, or `modelsFresh`/`modelsRefreshing` provenance flags to maintain: a picker's
  "Refresh catalog" row is just `agent.refreshConfig({ sessionId })` awaited and its `ConfigOption[]` result
  routed through the *same* `applyChatEvent(sessionId, { type: "config_options", options })` the push event
  uses — one arrival shape for a push, a direct refresh reply, or a `session.setConfigOption` reply alike,
  never three. `SessionRuntime.capabilities: ChatCapabilities` is seeded from `session.create`'s /
  `session.getMessages`'s response and kept current by the `capabilities` event; it is never null once a
  runtime exists (`EMPTY_RUNTIME`'s placeholder capabilities record has every flag false/`"none"`, for the
  brief pre-creation render only). The host-wide **`agentChangeTick: number`** + **`noteAgentChanged()`**
  (bumped on the `agent.changed` push, mirroring `fsChangesByWorkspace`'s tick convention) is the *entire*
  reaction to that channel here — it is deliberately data-free and non-replayable
  ([[module-contracts]]), so the store does not re-fetch anything on its own; a consumer (the agent
  picker, Settings → Agents) reads the tick and re-reads `agent.list`/`agent.providers`/`agent.detect` itself, the same
  way a panel reacts to `fsChangesByWorkspace`'s tick. **`defaultAgentId: string | null`** rides
  `applyConfig`'s fold of `AppConfig` (host-owned, `settings.update`-written) alongside the pre-existing
  theme/analytics/terminal/layout fields.

  **Genuinely retired, not translated:** the extension-UI bridge (`pendingExtUi` / `extUiQueue` /
  `extUiStatus` / `extUiWidget`, `applyExtUi`'s `select`/`confirm`/`input`/`editor`/`notify`/`setStatus`/
  `setWidget` cases, `clearPendingExtUi`) — elicitation and permission are its replacements, and `notify`
  is now the durable `NoticeMarker` a producer appends like any other message, never a push the store
  folds specially. The **in-app login stream** (`activeLogin`, `beginLogin`, `applyLoginFrame`,
  `clearLoginInput`, `clearLogin`, the `foldLoginFrame` reducer, and the `auth` module's `LoginState` type
  dependency) — interactive auth is elicitation or an `AuthMethodTerminal` in a real workspace PTY now
  ([[module-contracts]]'s "Genuinely lost" section); the `auth` module's presentational dialog and its
  reducer are unused by the store as of this change and are next-phase's to reconcile or retire.

  Closed
  chats are reopenable: the workbench close command first publishes the shared placement removal and only
  after host acceptance invokes **`closeChatToHistory`**, which **keeps the runtime + session alive** and
  records it in **`closedChatsByWorkspace`** (`ClosedChat[]`, per workspace, most-recent-first) and clears
  any pending jump/history-open request for that session — but **never a `routeChatTarget`**: the close
  acceptance is a delayed echo of an older click, while a route target may have been installed by a newer
  Back/Forward to that very chat; target lifecycle belongs to navigation supersession (`navTick` currency)
  and reconciliation consumption/absence, not to tab closure. File, diff, and registered-document render caches
  follow the same acceptance-before-removal order; once no layout
  write is pending, the shell reclaims only caches absent from both accepted placement and queued opens,
  without advancing user-navigation clocks. A newer remote restoration keeps or rehydrates them instead of
  losing the placement. **`reopenChat(workspaceId, …)`** restores
  runtime/history membership in its captured workspace even after another workspace becomes active; the shell layout integration adds
  placement to the locally chosen center group through the one structural commit path. **`noteClosedChats`** records
  disk-only sessions (from `session.list`) there too — idempotently (skips live/open/already-listed) — so a
  chat that survived a host restart is reopenable. **`deleteChat(workspaceId, sessionId)`** is the idempotent
  fold for both a confirmed local `session.delete` and the `session.deleted` broadcast: it atomically drops
  every tab the chat owns — its transcript, live plan page, and any dependent legacy document cache — plus
  its history row/runtime + skill baseline, records a page-lifetime tombstone, removes queued opens for the
  chat or its dependent documents, and queues a resource-removal intent. The shell layout integration
  removes every matching chat placement and session-backed plan reference through its pure mutation path,
  then reconciles local attention in the same transition. Until then the tombstone renders no body, so a
  stale local reference cannot recreate or hydrate the session. **`noteClosedChats`** and
  **`hydrateSession`** reject tombstoned session ids, so
  stale `session.list` / `session.getMessages` results already in flight cannot recreate a deleted chat;
  the tombstone survives workspace teardown because an older read can still settle afterward. The
  active-workspace hydration pass snapshots **`selectWorkspaceSessionIds`** before each `session.list`; when
  that authoritative read lands, **`reconcileWorkspaceSessions`** applies the same tombstone fold to every
  baseline id absent from the host result, repairing deletion events missed while disconnected without
  deleting a session created after the read began or advancing a user-navigation clock. Otherwise
  **`hydrateSession(summary, hydrated, activate?, syncedTick?, options?)`** rebuilds browser-local
  runtime/render state from a host `SessionSummary` + **`HydratedRuntime`** (from `chat/hydrate.ts` —
  `{ messages, configOptions, capabilities, plan }`, one field per part of `session.getMessages`'s response
  the runtime needs) on connect: `summary.record.{workspaceId,sessionId,title}` place the tab (composition,
  not flat fields — see [[module-contracts]]'s `SessionSummary`), `summary.isStreaming` seeds the runtime's
  live flag, and hydration installs `hydrated.{messages,plan}` plus a fresh runtime built from
  `hydrated.{capabilities,configOptions}`. There is no more failure-classification step here: a hydrated
  transcript's last `TurnSettledMarker` (if any) already says what happened, durably, so the old
  `lastSettlement`-vs-persisted-transcript fallback logic is gone along with `messagesToRuntime`'s pi-era
  retry/compaction/ask-answer reinterpretation — see `chat/hydrate.ts`'s own doc comment in this file's
  sibling module. Hydration is a no-op if a runtime already exists, so a
  live/ahead chat is never clobbered; `summary.queue`, present only for a live session with something
  queued, seeds the pending strip so a client attaching mid-run sees what is waiting.
  **`openChatSession(workspaceId, sessionId, capabilities,
  configOptions, syncedTick?, options?)`** creates a fresh runtime for a brand-new chat (the `session.create`
  path); `closeChatRuntime` / `clearWorkspaceState` drop a runtime. Per-session mutators taking a
  `sessionId`: `applyChatEvent`, `appendNotice`, `setChatDraft`, `applyPermission`/`clearPermission`.
  The **settings surface** state — **`settingsOpen`** +
  **`settingsSection`** (a const-object enum: `Agents`/`Github`/`Appearance`/`Layout`/`Terminal`/`Templates`/`Privacy`) with
  **`openSettings(section?)`** (deep-links to a section, defaults to Agents — agents are the first-class
  settings concept and providers nest under one) / **`closeSettings()`** /
  **`setSettingsSection()`** — lives here so the top-bar gear AND the Welcome agent warning open Settings
  to a section without prop-drilling through the shell. The **theme** state — **`theme: ThemeId`** (the
  host-owned selected opaque id; the themes module resolves visual fallback) with **`applyConfig(config)`**
  (folds the server-synced `AppConfig` in from
  `server.welcome` / the `settings.changed` broadcast) — lives here too; it's a **pure value only** (the
  theme-application side-effect is the shell's, keyed off `theme`), and defaults to
  `DEFAULT_CONFIG.theme` until the welcome arrives. **`layoutSettings: LayoutSettings`**,
  **`analyticsEnabled: boolean`**, and **`defaultAgentId: string | null`** ride the same `applyConfig` fold
  (host-owned, defaulted from `DEFAULT_CONFIG`). Layout settings are not a second copy of
  any workspace document: they carry only the portable preset catalog/default and group limit. The
  **toast queue** — **`toasts: Toast[]`** (oldest-first) with **`pushToast(toast) → id`** / **`dismissToast(id)`**
  and the ergonomic **`toast.error/success/info(message, title?)`** helper (wraps `pushToast` so a non-React
  call site — a `.catch` in a fire-and-forget wire call — can fire one) — lives here so any surface can raise
  a transient notification; the `panels/Toaster` renders + times them out (errors persist until dismissed).
  `pushToast` **coalesces an identical live toast** (same variant/title/message — a retried failure returns
  the existing id instead of stacking a twin) and **caps the queue at 5** (oldest drop — the viewport doesn't
  scroll, so the newest must stay visible).
  It's the home for a **rejected wire call with no better place to land** (no chat tab to host a notice),
  complementing `appendNotice` (which handles the in-chat case).
  The host-wide **`templatesVersion: number`** counter + **`bumpTemplatesVersion()`** (increment) is a bare
  invalidation signal, the same shape as `fsChangesByWorkspace`'s `tick` below — **`panels/TemplatesSettings.tsx`**
  and **`chat/TemplateEditorDialog.tsx`** call it after a `template.save`/`delete`, and the Templates
  settings panel's own lists refetch off it (its `useTemplateList` fetch generation). It is deliberately
  NOT a freshness source for the composer's `/` menu — that fetch runs uncached on every menu open,
  since files also change outside the app where no in-app counter can see (see `chat/SPEC.md`'s Template
  slots section); the store holds only the counter, never fetches. The **live-refresh signal** —
  **`fsChangesByWorkspace: Record<workspaceId, { tick, paths, truncated }>`** with
  **`noteFsChanged(payload)`** (folds a `workspace.fsChanged` push: `tick` increments per frame;
  `paths`/`truncated` are the last batch) — panels select their workspace's entry and refetch on `tick`
  change (the store holds only the signal, never fetches; `applyWorkspaceRemoved` drops a removed
  workspace's entry). The **review slice** — **`reviewsByWorkspace: Record<workspaceId,
ReviewSnapshot>`** with **`setWorkspaceReview`** (a `review.get` read landing) and
**`applyReviewChanged`** (folds a `review.changed` push — full snapshot, idempotent; every client,
including a mutation's initiator, converges here — no optimism); `applyWorkspaceRemoved` drops the
entry; the pending-draft count is a selector (`selectReviewDraftCount`), never duplicated in
components. The **Skills-reload badge** rides the same tick without a separate signal:
  `noteFsChanged` also folds **`skillChangeTickByWorkspace: Record<workspaceId, tick>`** — the tick of the
  most recent *skill-relevant* batch, from the host-authored `payload.skillChange` semantic (`detected` for
  a concrete project-skill path, `unknown` for a genuinely pathless uncertainty, `none` for concrete
  non-skill churn). It is independent of the capped generic `paths`/`truncated` pair, so a large build cannot
  masquerade as a skill change and a skill event after the path cap is not lost; it stays *accumulated* so a
  later non-skill batch never clears it. A fresh watcher's synthetic startup nudge remains conservative
  `unknown`. Transport's centralized skill-load preparation awaits `workspace.watchReady`, folds a duplicate
  unknown fallback unless the watcher was already known ready (the event push may have died during
  reconnect), then captures the store tick only
  afterward; then wrappers issue `session.create` / `session.getMessages` / `session.reloadResources`, so no
  call site can accidentally reverse readiness and baseline ordering. Each chat records
  **`skillsSyncedTickBySession: Record<sessionId, tick>`** = the tick it loaded skills at.
  It advances **only when resources are actually (re)loaded against current disk**: a fresh
  `openChatSession`, a disk-only `hydrateSession` attach, and **`markSkillsSynced(sessionId, syncedTick)`** on
  a successful reload (`markSkillsSynced` is **monotonic** — `Math.max`, so an out-of-order reload completion
  can't move the baseline backward — and a **no-op for a disposed session**, so a late completion can't
  resurrect an entry dropped by `closeChatRuntime`/`clearWorkspaceState`). A **live** `hydrateSession` restore
  reuses the server session's already-loaded skills (`getMessages` returns only the transcript, no reload)
  which the client can't date, so it advances **nothing** — the chat stays *conservatively stale* if a skill
  change has been observed, never falsely clearing. That
  `syncedTick` is the workspace tick captured at the **start** of the skill-loading round-trip, immediately
  after the shared `workspace.watchReady` preparation (`selectWorkspaceTick`, snapshot by the caller before
  `session.create`/`reloadResources`/`getMessages`), **not** at completion — so a skill change whose
  `fsChanged` frame folds while the load is in flight (which the load did not see) stays past the baseline
  and keeps the badge lit rather than being silently absorbed.
  The selector
  **`selectSkillsStale(state, workspaceId, sessionId)`** = `skillChangeTick > syncedTick` — store-derived
  (survives `ChatView`'s tab-switch remount) and per-session (a sibling/newer chat that loaded the current
  skills is not flagged; a reload clears only its own). Also **`updateFileTabContent(workspaceId, id, content,
  tick)`** — a `FileTab` carries the `tick` its content was loaded at, so `FilePane` detects staleness
  (`workspaceTick > tab.loadedTick`) across tab switches, and its diff twin
  **`updateDiffTabContent(workspaceId, id, original, modified, tick, loadedTarget)`** — a `DiffTab` follows the same
  staleness contract in `DiffPane`, in **two** dimensions: the fs tick and the review target the two sides were
  read against, written together so neither can outlive the content it describes. The transient
  A **`reveal-tool` `LayoutIntent`** is the arrangement-agnostic request to reveal/focus a singleton
  side tool; the shell layout integration consumes it and resolves the tool's current saved location.
  **`changesRequest`** and **`specRequest`** add an optional path/item target to that reveal and carry a
  browser-local request-time center destination without exposing layout concerns to feature views. Async
  resolution carries the local
  destination group's navigation-clock stamp captured at click time: if later attention overtakes it, the
  tool may still highlight the item but the stale completion cannot steal focus. Both intents are consumed
  after handling so remount/re-read cannot replay a structural open. Two fields remain necessary because a
  gitignored spec belongs to the spec graph, not the git-derived Changes view.
  **`specsByWorkspace`** +
  **`setWorkspaceSpecs`** hold each workspace's `spec.graph` snapshot (fetched by `panels`'
  `useWorkspaceSpecs`, kept fresh on the workspace fs tick) so
  the chat's turn divider can classify a written path as a spec off the very snapshot the Specs panel
  renders — one definition of "this file is a spec", via the **`specPathMatcher(nodes)`** selector; dropped
  with the workspace in `applyWorkspaceRemoved`. `setWorkspaceSpecs` **keeps the previous array identity when
  the re-read found no change** — most fs ticks touch no spec, and a fresh identity would invalidate
  `ChatView`'s matcher memo and re-derive every open chat's whole transcript about once a second.
  **`openDoc(tab)`** caches and places either a resolved **`DocTab`** or a **`PlanTab`** (`kind: "plan"`,
  id `${workspaceId}:plan:${sessionId}` — one page per chat, re-open focuses). Local placement persistence
  keeps only resolver kind + durable session identity, never cached content. `PlanPane` reads the host-owned
  plan live, so the page has no snapshot to go stale. **`DiffTab`** is a read-only Monaco diff of one
changed file over **one diff scope** (id `${workspaceId}:diff:${scopeKey}:${path}` — one tab per *(file,
scope)*: **the scope is part of a tab's identity**, because a tab's content must never change meaning
because the Changes tool's scope flipped underneath it; the tab carries its own `scope`, which is also what
`DiffPane` re-reads with, never the panel's current one).
**What a tab's identity fixes is *which scope* it shows — the kind, plus the sha for a commit scope.** A
branch-scope tab means "this file vs the workspace's **current** review target", and that target moving —
because commits landed on the branch, or because the user re-pointed it — is the same live-refresh contract
as the worktree changing underneath the tab, not a change of meaning; the target ref therefore does **not**
belong in the tab id (a branch name pins nothing — only a commit sha is immutable, and it is already in the
id). What it *does* require is that the tab re-read when the target moves: `selectDiffTabTargetRef` is that
second live dimension (see `panels/SPEC.md`'s live-refresh contract) — and that the tab **records the target
its content was actually read against** (`DiffTab.loadedTarget`, required, written by every content write).
Panes mount only while their resource is locally selected, so without that record a diff whose target moved
while it sat in the background would mount with the new target already in hand, conclude nothing changed, and show the *old*
target's diff under the new target's label; the cached value is what the mount compares against. Its
per-resource view state: `view` split|inline via
**`setDiffTabView`**, split the default; a markdown diff's `rendered` flag via **`setDiffTabRendered`**
(swaps raw lines for compiled documents — `DiffPane` offers it for markdown paths only); and
`ignoreWhitespace` via **`setDiffTabIgnoreWhitespace`** (Monaco's `ignoreTrimWhitespace`). All three go
through one internal `patchDiffRenderState(state, workspaceId, id, patch)` helper — locate-the-resource-cache
and merge lives once, so a new per-diff toggle is a one-liner, not another copy. Opened by `ChangesPanel`.
**`diffScopeByWorkspace`** + **`setDiffScope(workspaceId, scope)`** hold *what* each workspace's Changes
panel is diffing (read through **`selectDiffScope`**, which defaults to the shared, referentially stable
`BRANCH_SCOPE`); keyed **per workspace**, not app-wide like `changesView`, because a scope belongs to that
branch's review — a commit sha means nothing in another worktree — and dropped with the workspace in
`applyWorkspaceRemoved`. The transient **`chatLocationRequest`** — the history-search jump
  deep link; the requester activates the target project+workspace, the workbench shell integration
  opens/hydrates the target
  chat, `ChatView` consumes + clears — is **`ChatLocationRequest { workspaceId, projectId, sessionId,
  messageId, anchorText, navigation? }`** (`messageId: MessageId` — the transcript never renumbers, so
  there is no positional index to carry or resolve; a hit just names the message it points at directly),
  set by **`requestChatLocation(req)`** (which captures and
  advances an already-hydrated destination group's local clock *before* switching workspaces, and sets `selectedProjectId` +
  `activeWorkspaceId` **atomically**, the same invariant `activateWorkspace` upholds, since the target chat
  can live in a different project/workspace than the one the search ran from — the caller
  `useHistorySearch.openMessage` loads the destination project's workspaces first when absent) and cleared
  by **`clearChatLocation()`**; the target resolves directly against `messages.find(m => m.id ===
  messageId)`, falling back to the newest `anchorText` match when absent.
  The sibling transient **`historyOpenRequest { id, sessionId }`** — set by **`requestHistoryOpen(target)`**,
  cleared by **`clearHistoryOpen()`** — carries the shell's app-wide `Ctrl+R` to a chat, which opens (or,
  when already open, re-scopes) its history overlay; it goes through the store precisely because the chord
  fires outside the chat subtree entirely (see `shell/SPEC.md`'s "Global chords"). The target comes from
  **`selectHistoryTarget`** (the locally selected chat, else the workspace's newest chat) and the action
  atomically queues the workbench selection with the request; the request id correlates overtaken cleanup,
  and the intent carries the chat resource so a cache/placement id alias (including an id collision resolved
  by placement-only minting) still selects semantically. That selection deliberately does not focus the tab,
  because the mounted history query owns focus. The shell updates the group's local attention so the target
  body mounts and consumes the request without publishing a structural snapshot. The `EditorTab` (`FileTab`
  | `ChatTab` | `DocTab` | `DiffTab` | `PlanTab`) + `TerminalTab` + `ClosedChat` + `SessionRuntime` types.
  (Chat *render* types + renderers live in the `chat` module.) The pure context
  selectors in `selectors.ts` resolve the active `Workspace`, its owning project id, and the shell's context
  project from those canonical ids and collections; derived active-project state is never stored separately.
- **Public surface (barrel):** `useAppStore`; `selectActiveWorkspace`, `selectWorkspaceById` (the
  one lookup for "the workspace with this id" — `selectActiveWorkspace` is it applied to the active id, and
  `openFileInTab`/`ChatView` read the worktree root through it),
  `selectWorkspaceTerminals` (the host-owned terminal catalog; the layout visibility gate derives mounted
  identities from its supplied document + local attention, while host attachment remains exclusive per terminal),
  `selectActiveWorkspaceProjectId`, `selectResolvedAgentId` (a project id's effective agent — its own
  `agentId` override, else `AppConfig.defaultAgentId`, else the connected `defaultAgent`, mirroring
  `session.create`'s host-side precedence for callers that need to know it before opening a chat, e.g.
  `AgentWarningBanner`), `selectHistoryTarget` + `HistoryTarget` (the shell's `Ctrl+R` routing
  target: the locally selected chat resource, or the workspace's newest chat otherwise),
  `selectContextProject`, the layout placement selectors (recursive center plus left/right/bottom auxiliary
  groups), `selectAttentionCenterTab` (the selected resource in local last center focus),
  `selectCurrentRouteChatTarget` (exact-chat intent only while its workspace and stamped navigation remain
  current), `selectSkillsStale`, **`selectDiffScope` + `BRANCH_SCOPE`** (what a workspace's
  Changes panel is diffing, defaulting to the shared branch-scope constant), **`selectDiffBaseRef`** (the ref
  it is measured against — the client-side mirror of the host's one resolution), **`selectDiffTabTargetRef`**
  (that ref *as an open diff tab's live dimension*: the target for a branch-scope tab, `""` for a
  commit/uncommitted one whose sides can't move — derived here, never re-assembled in a panel),
  `selectWorkspaceTick` (the sync-baseline snapshot), `selectWorkspaceSessionIds` (deduplicated local chat
  placement + history membership used as a reconnect-reconciliation baseline);
  `matchesWorktreePath` (line an agent-reported path — relative or absolute — up against a worktree-relative
  one; shared by the Changes deep link and the spec classifier. The suffix rule is for **absolute reports
  only** and is anchored at a separator: unanchored, `/wt/src/a-foo.ts` would match `src/foo.ts`; applied to
  relative reports, `module-b/SPEC.md` would match the *root* `SPEC.md`) + `specPathMatcher` (is a written
  path a spec-graph node?);
  `SessionRuntime`, `RetryProgress`, `reduceChatEvent` (the pure per-runtime `ChatEvent` fold),
  `applyChatEvent`/`appendNotice`/`applyElicitation`/`clearActiveElicitation`/`applyPermission`/
  `clearPermission`/`noteAgentChanged` (the chat-runtime action surface),
  `toast` (the fire-from-anywhere helper),
  `Toast` (type), `WorkspaceLayoutSnapshot`/attention selectors and actions, resource render-state types
  (file/diff/virtual-document/plan/chat), `TerminalTab`, `ClosedChat`, `EMPTY_RUNTIME` (ChatView's
  pre-creation fallback), `ChatLocationRequest` (type).
- **Allowed deps:** `contracts` (`Project`/`Workspace`/`AgentDescriptor`/`AgentPlan`/`AgentStatus`/
  `ChatCapabilities`/`ChatEvent`/`ChatMessage`/`ConfigOption`/`ElicitationPush`/`ElicitationRequest`/
  `PermissionPush`/`PermissionRequest`/`RetryScope`/`SessionSummary`/`SessionUsage`/`SlashCommand`/
  `ToolCallId`/`WorkspaceFsChangedPayload`/`WorkspaceLayoutSnapshot`/`LayoutChangedPayload`/`AppConfig`/
  `ThemeId`; `DEFAULT_CONFIG` for the pre-welcome default); `lib` (the shared
  path + array primitives — `shallowEqualArrays` for the snapshot-identity guard; a leaf, so the edge adds
  no cycle); `chat` (`HydratedRuntime`, **type-only** — the `session.getMessages` → runtime projection);
  `transport` (`ConnectionStatus`, **type-only**); `zustand`. The `auth` (`LoginState`) and skill-invocation
  (`lib/skillInvocation`) type-only dependencies from the pi-era design are dropped: login no longer routes
  through the store (see the retired-login paragraph above), and echo reconciliation no longer needs
  text-based skill-command matching now that `message_start` upserts by id.
- **Forbidden:** `server`/`shared`/`pi`; importing `panels`/`shell` or transport runtime.
