---
id: module-contracts
type: module-design
status: draft
title: Wire contracts (types-only, agent-free)
parent: architecture
depends-on: []
references: [architecture, central-integration, module-acp, module-server, module-web, submodule-server-transcript]
covers: [wire-contract, chat-transcript-model, chat-event-stream, agent-capability-record, agent-registry-wire, elicitation-wire, permission-wire, config-option-wire]
tags: [v1, wire, acp]
---

## Responsibility

The browser↔host wire spine, and **the single conversation vocabulary in the repo**. `packages/acp`
produces it, `packages/server/src/transcript` persists it, `apps/web` renders it. Types-only, with the
only runtime exports being the WS registries, the protocol version, `DEFAULT_CONFIG`, the history caps,
the terminal replay bounds, the control-message marker, the synthetic-tool-name marker, and the
durable-event predicate.

**This module is agent-free.** It names no agent, imports no agent SDK, and carries no ACP shape. That
edge makes the UNSTABLE half of ACP survivable ([[architecture]] Decision #19) and the chat renderers
reusable by any host that speaks this wire.

## Boundary

- **Owns:** entity types (`domain`), the chat transcript + event model, the capability record, the agent
  descriptor/registry types, elicitation and permission types, the search-corpus shapes, the WS method
  and channel registries, the protocol version. Including **`WsErrorCode`** — the closed set of failures
  the *host names* (`WsResponse.errorCode`, today `UNKNOWN_COMMIT` and `PUSH_AUTH_FAILED`), so a client
  can react to one specific failure instead of pattern-matching an error message. A failure earns a code
  only when a client behaves differently for it; everything else stays a plain `error` string. Expected
  method-specific synchronization outcomes, such as a stale layout replacement, remain typed method
  results rather than generic WS failures.
- **Public surface (`index.ts`):** `export type *` of `chatProtocol` + `domain`; value re-exports
  `DEFAULT_CONFIG`, `MAX_HISTORY_LIMIT`, `MAX_HISTORY_QUERY_LENGTH`, `TERMINAL_REPLAY_KB`,
  `TODO_NUDGE_PREFIX`, `isControlMessage`, `SYNTHETIC_TOOL_NAME_PREFIX`, `isSyntheticToolName`,
  `DURABLE_CHAT_EVENT_TYPES`, `isDurableChatEvent`; `export *` of `wsProtocol`.
- **Allowed deps:** **none** — not at runtime, not type-only. The manifest declares no `dependencies`
  at all; the only devDependencies are `typescript` and `@types/bun`, and `@types/bun` is there solely
  so `boundary.test.ts` can run under `bun test`. Because it makes Bun's globals visible to `tsc`
  inside this package, that same test forbids any source here from naming a host runtime.
- **Forbidden:** any pi package (value or type, any subpath); `@agentclientprotocol/sdk` or any other
  ACP typing; `server` / `shared` / `acp` / `web`; `Bun`, `process`, `require`, `import.meta` or any
  other host runtime, in every file but the test.

## One vocabulary, three consumers

The previous revision re-exported pi's message algebra type-only. Cheap with one engine; exactly what
made the swap expensive. Under ACP the trap is worse — most of the surface we would lean on
(`ToolCall.name`, `Usage`, `providers/*`, elicitation, `session/fork`) is **UNSTABLE** upstream. So the
wire declares its own shapes, and **exactly one set of them**: `ChatEvent` is simultaneously the push
frame, the transcript store's input and the web reducer's input. No second "transcript event"
vocabulary, no host-side re-translation. A reloaded transcript is the same object graph the live view
held **by construction**, because both are the same fold over the same events.

## The rules that hold it together

- **Identity is an opaque `MessageId`**, minted once by `packages/acp`'s assembler through an injected
  clock whose generator the host supplies. Jump anchors, React keys and the transcript log all address a
  message by it. This retires the positional `messageIndex` anchor — three counters kept in step by a
  shared role set, where adding one role shifted every later anchor with nothing to fail. Search hits
  carry `messageId`; `anchorText` stays as a sanity check.
- **Three write modes, and only three.** `chunk` APPENDs text/thinking at `(messageId, index)`, creating
  the block if absent; `block` SETs a whole block (image, resource, toolCall — these arrive complete);
  `tool_call_update` REPLACEs the fields its patch names, `output` wholesale. The transcript log records
  the same three, so there is no second streaming rule to keep in sync.
- **The host assigns block indices.** ACP recovers block order only from arrival order, which a
  reloading client never witnessed. Explicit indices make live and hydrated derivations byte-identical
  and keep activity-step ids stable across streaming snapshots.
- **`message_start` for a known id REPLACES that message.** One rule covers the optimistic composer
  echo, the echo dedupe and pi's `/skill:x` → expanded `<skill …>` upgrade — no `message_replace`
  event, no second bubble.
- **Tool calls are one record.** No `toolResult` role, no results index, no hydration pairing step.
  `status` adds `pending` and **`abandoned`**: a tool that *failed* and a tool the turn *outran* read
  differently, and only the host — which knows when the turn settles — can tell them apart.
- **`toolName` is required.** The renderer registry, the activity histogram, the phase label, the
  specs-vs-changed-files partition and the ask-card gate all key on one string, while `ToolCall.name` is
  UNSTABLE, optional *and* nullable. `packages/acp` resolves it, falling back to `acp:<kind>`;
  `SYNTHETIC_TOOL_NAME_PREFIX` is exported so the translator that mints it and the UI that must prefer
  `title` over it read one string, and so a synthetic name can never shadow a registered renderer.
- **`ToolOutput.terminal` carries `terminalId`, which is also the workspace tab key.** The host mints one
  string for both when it serves `terminal/create`, so there is no id→tab table. Corollary (Decision
  #9): an agent-spawned shell appears as a user-visible terminal tab.
- **`StopReason` is ThinkRail's own vocabulary** (`completed | maxTokens | maxRequests | refused |
  cancelled | failed`), not a mirror of ACP's spelling — a wire that mirrors ACP follows ACP's renames,
  which is what Decision #19 exists to prevent. `failed` is synthesized from the transport error that
  rejects a prompt. `TurnSettledMarker.startedAt` makes the round divider's span self-contained so the
  elapsed figure does not jump on reload.
- **Pickers are one mechanism.** `ConfigOption` replaces `WireModel`, `model.list`, `model.default`,
  `model.clampThinking`, `session.setModel`, `session.setThinkingLevel`. The agent republishes the whole
  set whenever any changes, making effort re-clamping structural rather than a wire method. Grouping is
  always present (`name: null` for flat) so the picker has no branch. A mode change is a
  `config_options` event, never its own — carrying both would reinstate two mechanisms for one picker.
- **Usage is pushed, not polled**, retiring `session.getStats`. `contextUsed: number | null` keeps the
  unknown-after-compaction state first-class (`?/200K`). `percent` is deliberately absent: it is a store
  selector, so the derivation lives in one place. `Money` carries an ISO-4217 currency.
- **`SessionSummary` is composition, not inheritance.** `SessionRecord` is the transcript store's durable
  half; `SessionSummary` wraps it with `agent`, `isStreaming`, `live`, `openTodos` — the process facts
  only the session manager has. Neither owner can take over a field of the other's, and there is no
  duplicated `agentId`/`agent` derivation.
- **`ChatCapabilities` is flat** so panels read `caps.modelPicker` without ceremony; `derivedFrom` gets a
  precise `keyof ChatCapabilityFlags` key set for the "why is this missing?" affordance and the
  fake-agent tests. `steering`, `plan` and `mcpTools` are unions, not booleans, because the honest
  answer is not binary.
- **`isDurableChatEvent` lives on the wire, not in the store.** `turn_start`, `commands`, `plan`,
  `capabilities`, `agent_status` and the retry/compaction/queue frames describe a *live process*;
  rebuilding them from a log would be lying about a process that no longer runs. Publishing the
  predicate here rather than duplicating the list in the store keeps producer and persister from
  drifting.

**Rejected: cumulative snapshots.** Accumulating and re-emitting whole messages would leave the web
reducer untouched but ship every token of a long message on every delta — over Tailscale to a phone.

**Rejected: `messages_removed`.** Compaction-overflow correction does **not** delete. Decision #4 calls
the transcript append-only, and the record belongs to the user rather than to the agent's context
window, so a superseded attempt is annotated (`message_superseded` → `AssistantMessage.superseded`) and
rendered collapsed. Same UI outcome, no tombstoning of an append-only log.

**Agent plans and ThinkRail's todo plan are capability-selected and never merged.** Merging a read-only
list into an editable one produces a plan the user can edit and the agent silently overwrites.

**Elicitation replaces the extension-UI dialog kinds** (`select`→select, `confirm`→boolean,
`input`→text, `editor`→text+`multiline`). **Permission is its own surface**, rendered inline on the tool
card it names rather than as a modal, so the user approves the thing they are looking at.
**`ask_user_question` keeps its shape and loses its ack**: the presence of the call *is* the
questionnaire, and the reply is a `questionAnswers` marker.

**One gap fixed:** user-message images were accepted by the composer, sent over the wire and then
silently dropped on render. `ImageBlock` is a first-class member of `PromptContent` and `ChatBlock`.

## `chatProtocol.ts`, type by type

What follows is the public-surface contract: what each field is *for*, which is what a producer must
honour and what a renderer may rely on. It is not a description of any one component.

### Identifiers and content blocks

`SessionId` is also the UI tab id. `MessageId` is stable forever. `ToolCallId` is unique within its
session and is the address a tool card replies to.

- `TextBlock` is assistant prose, rendered as a `markdown` row (react-markdown + remark-gfm + shiki +
  mermaid). `ThinkingBlock` is the agent's internal reasoning, rendered as a thinking step inside an
  activity group and as the `Thinking…` stream phase; its payload field is `text`, matching
  `TextBlock`, so every chunked block reads the same way and `chunk` needs no per-kind field lookup.
- `ImageBlock` carries base64 in `data`; `uri` is the provenance, shown as the caption. It renders
  inline in a user bubble or in a tool card's output pane.
- `ResourceBlock` is a file / URL / @-mention, rendered as a chip. `text` present means the contents
  travel with the message (the composer's @-mention upgrade); absent means it is a link the agent
  resolves itself. `title` is the display title when it differs from `name`, `size` the chip's
  sub-label.
- `ToolKind` drives the card's icon and the activity step's glyph. `ToolCallLocation` feeds the round
  divider's changed-files chips and follow-along.
- `ToolOutput` is the card's body: `text` (with `truncated`), `image`, `diff`, or `terminal`, which
  embeds a live ThinkRail PTY at `terminalId`.
- `ToolCallBlock.title` is human-readable prose ("Reading src/index.ts") and becomes the card header
  when `toolName` is synthetic. `arguments` carries the named inputs the built-in cards read
  (`bash.command`, `read.path`, `edit.oldText`/`newText`, `ask_user_question.questions`, …);
  ThinkRail's own tools always supply them, an external agent may not, and such a card renders from
  `title` + `locations` + `output` instead. `locations` is the divider's changed-files source when
  `arguments` carries no path. `result` is the tool's structured result, what a custom renderer
  narrows. `error` is set only together with a terminal `status`, never on its own.
- `PromptContent` is what a user can send: prose, pasted/dropped images, @-mentioned resources.
- `SYNTHETIC_TOOL_NAME_PREFIX` is `acp:`. Beyond keeping producer and UI on one string, the prefix is
  what stops a synthesized name from colliding with a registered renderer key — pointing an unknown
  `execute` tool at the bash card would have it read a `command` argument that does not exist.
  `isSyntheticToolName` is the test the UI uses to prefer `title` over the name.

### Markers

- `TurnSettledMarker.startedAt` is the opening user message's timestamp.
- `CompactionMarker` renders as a labelled rule that opens the summary, so a long chat explains its
  gap instead of appearing to start mid-conversation. `reason` is `manual | threshold | overflow`;
  `tokensBefore` is the context size before the pass, as the agent measured it.
- `QuestionAnswersMarker` is never rendered as its own bubble — the questionnaire card pairs it by
  `toolCallId` and switches to its answered state.
- `NoticeMarker` is an inline system notice row: an agent or host message to the *user*, not to the
  model. `NoticeLevel` drives the row's tint.

### Transcript messages

- `UserMessage.content` is always an array, never a bare string, so the bubble renderer, the ↑-recall
  list and the jump anchor all read one shape. `timestamp` starts the round divider's wall clock.
  `hidden` marks host control traffic (the TODO nudge): recorded, never rendered, never searchable.
- `AssistantMessage.blocks` is *the* assistant rendering model — its order is what makes an activity
  run contiguous. `endedAt` is when the agent finished this message's content, absent while it is
  still streaming.
- `MarkerMessage` is generic so a producer can be compile-held to one marker kind (the `turn_settled`
  event carries `MarkerMessage<TurnSettledMarker>`).

### Session configuration

`ConfigOptionCategory` says what a picker controls: `model` renders the model picker, `thinkingLevel`
the effort picker, `mode` a mode picker, `modelConfig` a model-scoped sub-setting, and `other` is
anything an agent exposes that ThinkRail has no dedicated UI for and renders generically.

- `ConfigChoiceMeta` is the model picker's sub-line — `contextWindow` reads "200K context",
  `reasoning` appends a `reasoning` tag. Absent means no sub-line.
- `ConfigSelect.value` is the current choice's id; an **empty `groups` list means the picker is
  absent**. For the model picker the groups are the providers. `ConfigToggle` is an on/off switch an
  agent exposes (e.g. "auto-approve edits").
- `ConfigSummary` is just enough of a session's config to label its pills without shipping a whole
  model catalog per chat-history row; `valueName` is the pill's label. It rides on `SessionRecord`,
  while the full option set arrives with the opened chat.

### Usage

`Money` renders as the stats strip's `$0.123` chip. `TokenUsage` is that strip's
`↑12.3k ↓4.5k R80k W2.1k`, with zero-valued fields omitted by the renderer and `thought` carrying
reasoning tokens when the agent separates them out. `SessionUsage.contextUsed: null` renders as
`?/<window>` with an empty bar.

### Agent plan

`AgentPlanEntryStatus` (`pending | active | done`) matches ThinkRail's todo vocabulary so one
renderer serves both; `AgentPlanEntryPriority` is the row's priority glyph. `AgentPlan` is flat,
agent-owned, and replaced wholesale on every update; ThinkRail's own todo plan is grouped,
user-editable, persistent, and read via `todo.list`.

### Slash commands and skills

- `SlashCommand.name` is both the `/` menu row's label and the exact text inserted (`/name `);
  `description` is the secondary line. `source` / `sourceInfo` are optional because most agents
  report no provenance — the chip renders only where the host knows the answer (its own prompt
  templates) or the agent volunteers it. `argumentHint` is the agent's own "takes an argument" note;
  ThinkRail's prompt-template slot grammar is a separate, richer mechanism that lives host-side and
  never travels on this wire.
- `SlashCommandSourceInfo` is the `prompt/project` chip and the menu row's key.
- `SkillDecision` has four members so a hidden skill is never a silent mystery: `load` = in the
  agent's context, `untrusted` = a project alias under an untrusted project, `pending-ack` = a
  project alias that appeared after trust was granted, `disabled` = admissible but toggled off.
- `SkillCatalogEntry.name` is the bare skill name and the key ack / enable-disable / override
  operations use. `gated` marks a committed project-scoped alias (the trust-gated class), `plugin`
  names the installing plugin so the manager can group by it, and `group` is the canonical group key
  the skill toggles under: a plugin name, or `project` / `personal` / `bundled`.

### Agents

`AgentRegistryEntry.notRecommended` carries ThinkRail's own caution about a published row — the picker
renders that reason beside the entry rather than presenting it as a neutral choice. It is advice the
user can overrule, never a block; see `packages/acp/src/registry/SPEC.md` for the standing case.
`AgentProvidersReport.jbcentral`/`jbcentralInstall` are **optional**: the host sends the JetBrains
Central half only for an agent whose registry profile actually routes through Central, so the card
cannot appear under an agent it has nothing to do with. `anyConfigured` is the host's own answer to
"can this agent run" — `providers.some(configured)` OR'd with Central being signed-in and configured
when the agent's profile uses it. A generic surface like the Welcome banner reads this one field and
never learns that Central exists; only `agent`-panel UI that renders the two mechanisms side by side
reads `providers`/`jbcentral` directly.


- `AgentOrigin` (`bundled | installed | external`) is the picker's grouping and the "can I remove
  it?" answer. `AgentDescriptor.protocolVersion` is the version negotiated with that agent, surfaced
  when explaining a capability gap; `icon` comes from the registry entry.
- `AgentDistribution` mirrors the three shapes the published registry actually uses (`npx`, `uvx`,
  `binary`); an entry whose distribution matches none of them is **skipped rather than guessed at**.
  `binary.sha256` is the registry-published digest of `archive` — about half of published builds
  carry one.
- `AgentRegistryEntry.distribution: null` means no distribution matches this host's OS/arch and the
  row renders as unavailable; `installedVersion` differing from `version` drives an Update action.
- `InstalledAgent.command` / `args` are shown so a user can verify what will execute; `capabilities`
  is the last negotiated record, present once the host has connected to that agent before;
  `unavailable` is the row's warning (binary missing, unsupported protocol version).
- `AgentAuthMethod.kind`: `agent` — the agent drives it and may ask through elicitation; `envVar` —
  the user supplies a key the host passes as an environment variable; `terminal` — the agent's own
  TUI, which ThinkRail hosts in a real workspace terminal, launched with `terminalArgs`/`terminalEnv`
  merged onto the agent's normal launch spec so the same binary runs its login flow instead of ACP.
  `link` is the documentation or sign-up link offered alongside. `AgentAuthEnvVar.secret` **defaults
  to true at the renderer**: an unmarked variable is treated as secret.
- `AgentProviderInfo.name` falls back to `id`; `required` hides the row's off switch; `configured` is
  whether the provider is usable right now; `protocols` (e.g. `anthropic`, `openai`) is the row's
  sub-label; `baseUrl` is a non-secret routing endpoint, never a credential-bearing URL.
- `AgentStatus` is the agent process's health as the supervising host reports it: `spawning`,
  `ready`, `crashed` (where `willRestart` decides between a transient notice and a persistent
  failure), `restarting`, and `unavailable` — it cannot be started at all (binary missing, spawn
  refused, protocol version rejected).

### `ChatCapabilityFlags`: one field per UI-visible affordance

Panels **read these**; they never probe the agent and never branch on which agent is running. What an
agent cannot do is **absent** from the UI, not disabled.

*Composer.*

- `imageInput` — pasted/dropped images may be sent. Off → the composer offers no image affordance.
- `embeddedContext` — @-mentions may carry file contents rather than just a path.
- `steering` — mid-turn steering. `queued` → the composer says the message will be sent when the turn
  ends.
- `followUp` — a message may be queued to start the next turn.
- `slashCommands` — the agent publishes commands for the `/` menu.
- `promptTemplates` — ThinkRail's prompt templates are offered in the `/` menu. Host-provided, so
  true everywhere.

*Pickers.*

- `modelPicker` — a `model`-category config option exists. Off → no model pill.
- `thinkingLevel` — a `thinkingLevel`-category config option exists. Off → no effort pill.
- `modes` — a `mode`-category config option exists.
- `configRefresh` — `agent.refreshConfig` is available; the picker shows its Refresh-catalog footer
  row.

*Telemetry.*

- `cost` — the agent reports cost; the stats strip shows the money chip.
- `tokenBreakdown` — the agent reports per-kind token counts; the strip shows `↑ ↓ R W`.
- `contextWindow` — the agent reports context usage; the strip shows the five-cell context bar.

*Conversation surfaces.*

- `plan` — which plan the Plan pane renders.
- `elicitation` — the agent can ask the user for structured input; the modal dialog is wired.
- `permissions` — the agent asks before acting; the inline permission prompt is wired.
- `skills` — the Skills manager is offered. Off → the whole surface is absent, not empty, because
  ThinkRail cannot enumerate or veto what an external agent loads.
- `workflowSkills` — ThinkRail's workflow skills route automatically. Off → their documents are
  user-invoked prompts.
- `mcpTools` — how ThinkRail's own tools reach this agent. `none` → spec/todo/visualize cards never
  appear.
- `fileDelegation` — the agent's file reads/writes pass through the host, so unsaved editor buffers
  are visible to it.
- `terminalDelegation` — the agent's commands run as watchable ThinkRail terminals in the right
  worktree.

*Session lifecycle.*

- `sessionList` — the agent can enumerate its own sessions (ThinkRail's transcript is the corpus
  either way).
- `sessionLoad` — the agent can resume a past session's context; a reopened chat continues rather
  than restarts.
- `sessionFork` — a chat can be branched (the transcript's "fork from here" action).
- `sessionClose` — a chat's agent-side resources can be released without ending the process.

*ThinkRail extensions, optional per agent.*

- `retryVisibility` — attempt-level retry countdowns are reported, so the retry rows can appear.
- `compactionVisibility` — compaction lifecycle is reported, so the compaction marker and its
  progress can appear.
- `queueDepth` — queue depth is reported, so the composer can show how many messages are waiting.

*Auth and provider setup.*

- `authentication` — the agent advertises auth methods; the sign-in card is offered.
- `logout` — stored credentials can be removed; the card offers Sign out.
- `providerConfig` — providers can be listed and re-pointed; the Providers rows are offered.
- `jetbrainsCentral` — the JetBrains Central setup card applies to this agent's provider
  configuration.

The three non-boolean flags: `SteeringSupport` is `native | queued | none`, `PlanSource` is
`thinkrail | agent | none`, and `McpToolDelivery` is `native | acp | http | none` — `native` meaning
registered in-process by our own agent.

`ChatCapabilities` is folded once at connect from the agent's advertised capabilities, its ThinkRail
extension advertisement, and the registry's per-agent profile, then **widened by observation** for the
surfaces no protocol capability announces (plans, commands, usage, config options). `CapabilitySource`
records which of those five (`agent | meta | registry | host | observed`) supplied each flag.

### Session record and summary

- `SessionRecord.cwd` is the worktree the chat runs in and `agentId` is which agent produced the
  transcript. `updatedAt` is epoch ms of last activity — chat-history ordering and each closed chat's
  timestamp. `promptCount` counts visible user messages, control traffic excluded. `lastSettlement`
  is the latest recorded turn terminal, which is what keeps the persistent failure banner correct
  across reconnect without fetching a transcript per row; `null` means the session has never settled.
  `usage` is the last reported usage, seeding the stats strip for a rehydrated tab.
- `SessionSummary.isStreaming` means a turn is in flight: the tab shows the loader and the composer
  steers instead of sending. `live` is `true` for a session with a live agent process in this host
  (auto-restored as an open tab) and `false` for one that exists only in the transcript store
  (surfaced in chat history, re-opened on demand) — a disk session's `record.config` is what it last
  reported. `openTodos` counts unfinished items in the chat's ThinkRail todo plan and is populated
  only by `session.list`, as a hydration hint so a client auto-opens chats with work in progress;
  absent means unknown, treated as 0. `queue` (**`SessionQueueState`**: the pending `steering`/`followUp`
  texts) rides a live summary only when non-empty — the hydration seed for the client's pending strip,
  since `queue_changed` fires only on changes and a client attaching mid-run would otherwise never learn
  of messages queued before it connected. Per-row editing is position-addressed
  (`session.removeQueued` takes `{ kind, index }`) because queue entries are bare strings with no id.

### The event stream, member by member

`ChatEventPayload` tags one session's event with its id. `RetryScope` exists because the turn and
summarization retry flows can overlap and are cleared independently, so one flow's end never clears
the other's row.

- `turn_start` — a prompt turn began: the composer switches to steer/abort and the stream indicator
  mounts.
- `turn_settled` — THE run terminal. It clears live streaming state, drops retry countdowns, and
  appends the durable record the round divider measures against. One event, one fact — not an
  ephemeral signal plus a separately-emitted record that could disagree.
- `message_start` — appended to the transcript, or (for a known id) replaced in place.
- `message_end` — an assistant message is complete: its thinking steps stop spinning even while its
  tools still run.
- `message_superseded` — render it collapsed, never remove it.
- `chunk` / `block` / `tool_call_update` — the three write modes above.
- `config_options` — the complete config set, republished: the model, effort and mode pills.
- `commands` — the `/` menu's agent-side entries changed.
- `usage` — cumulative usage for the stats strip and the context bar. Pushed, never polled.
- `session_info` — session metadata changed; this is what renames the chat tab.
- `plan` — the agent's own plan, or `null` when it withdrew one. Rendered only when
  `capabilities.plan === "agent"`.
- `capabilities` — the negotiated record changed (reconnect, agent restart, observation widened it).
- `agent_status` — the agent process's health. Sent to *every* session that process hosts.
- `retry_scheduled` — a retry countdown row ("Retrying — attempt 2/5 in 4s"); `retry_cleared` clears
  the countdown for one scope only.
- `compaction_start` / `compaction_end` — a compaction pass as progress within the same unsettled
  turn; the durable record is a `compaction` marker message, not these frames.
- `queue_changed` — the composer's queued-message count, plus the queued texts themselves whenever the
  **host** owns the queue (steering emulation); a `native`-steering agent reports depth alone through
  `_meta`, so the strip shows a count and no editable rows.

### Transcript search corpus

`TranscriptCorpusEntry.text` is full text, never truncated: it is what prompt recall inserts and what
the preview shows. `TranscriptCorpusSession` carries the scope labels a hit needs.
`TranscriptCorpusSnapshot.complete` is `false` while the first cold load is still running.
`TranscriptSnapshot` is what `session.getMessages` returns — an array, never a replay stream.

### Elicitation

Rendered as the modal dialog: one at a time, with a FIFO queue behind it.

- `ElicitationField` covers `text`, `select`, `multiSelect`, `boolean` and `number`. `secret` (mask
  the input, an API key) and `multiline` (render a textarea) are **ThinkRail display hints with no
  protocol carrier** — an agent that sets neither gets a plain single-line input. `number.integer`
  means whole numbers only.
- `ElicitationFormRequest.sessionId` is absent for a pre-session request (auth or configuration
  before any chat exists); `toolCallId` is present when the request came from a tool call, and the
  dialog names which one. `ElicitationUrlRequest` is the agent needing the user to visit a URL (an
  OAuth hand-off), rendered as a link plus progress.
- `ElicitationResponse.values` is present only for `accepted`.
- `ElicitationPush`'s `cancel` is the agent withdrawing a pending request (it aborted, or it timed
  out): the dialog closes and the queue promotes, so no agent promise is orphaned.

### Permission

`PermissionOptionKind` drives the button's tone and whether the answer is remembered.
`PermissionRequest.call` carries enough of the tool call to render the card *before* it is approved.
`PermissionDecision`'s `cancelled` is the turn being aborted while the prompt was open, and
`PermissionPush`'s `cancel` withdraws a prompt the agent no longer needs.

### `ask_user_question`

A ThinkRail-owned tool — registered natively by our own agent, exposed over MCP to every other one —
rendered **inline in the chat**, not as a modal. The questionnaire is authored in the tool call's
`arguments`; the reply travels back through `session.answerQuestion` and lands in the transcript as a
`questionAnswers` marker. **The call itself ends the agent's turn**, so nothing blocks and the
transcript stays valid across host restarts.

- `AskUserQuestionArgs` carries 1–4 questions. Each has the full question text (ending with "?"), a
  `header` chip of at most 16 characters, and 2–4 mutually-exclusive `options` unless `multiSelect`,
  where the free-text row still rides along as an extra answer.
- An option's `label` is 1–5 words and `description` says what the choice means or its trade-off.
  `preview` is markdown shown beside the option (code, a diagram, config) and is single-select only;
  `recommendedReason` renders as an inline `Why:` line under the description.
- `AskUserQuestionAnswer.kind` tags how the answer was produced: `option` — picked one author-defined
  option, `answer` being its label; `custom` — typed free text, `answer` being the text; `multi` —
  committed multi-select choices, `selected` being the chosen labels and `answer` any additional free
  text or `null`. `preview` is echoed back when the chosen single-select option carried one.

## `wsProtocol.ts`

The browser↔host API — ours, not the agent protocol's. `WS_METHODS` are request/response, `session.*`
driving one chat and `agent.*` the engine behind it; `WS_CHANNELS` are server→client push.

`session.create` → `{ sessionId, agent, capabilities, configOptions }`, so the composer and both pills
are correct on the first paint. `prompt`/`steer`/`followUp` take `PromptContent[]` and answer
`{ messageId }`, retiring the optimistic-echo text match. `session.setConfigOption` is the ONE picker
write. `session.getMessages` → `{ summary, messages, configOptions, capabilities, plan }`: an **array**,
because ACP's `session/load` replays as notifications and adopting that would race the live stream on
every reconnect; and a fat read on purpose, so no tab ever has messages but no composer chrome.
`model.*` and `provider.*` collapse into `agent.*`. Channels: `chat.event`, `agent.elicitation`,
`agent.permission`, `agent.changed` (data-free invalidation; reconnect reads repair a missed
transition). The **fail-closed allowlist** survives the swap: `AgentProviderInfo` renders exactly what
is listed, never a projection of whatever the agent reports.

### Pinned method table (`PROTOCOL_VERSION` 51)

```
session.create              { workspaceId }                              → SessionCreated
session.prompt              { sessionId, content: PromptContent[] }      → { messageId }
session.steer               { sessionId, content: PromptContent[] }      → { messageId }
session.followUp            { sessionId, content: PromptContent[] }      → { messageId }
session.clearQueue          { sessionId }                                → SessionQueueState
session.removeQueued        { sessionId, kind: QueueLane, index }        → RemovedQueuedMessage
session.abort               { sessionId }                                → Ack
session.delete              { workspaceId, sessionId }                   → Ack
session.setConfigOption     { sessionId, optionId, value }               → ConfigOption[]
session.getCommands         { sessionId }                                → SlashCommand[]
session.reloadResources     { sessionId }                                → Ack
session.answerQuestion      { sessionId, toolCallId, result }            → Ack
session.answerPermission    { decision: PermissionDecision }             → Ack
session.list                { workspaceId }                              → SessionSummary[]
session.getMessages         { sessionId, workspaceId }
                            → { summary, messages, configOptions, capabilities, plan }

agent.list                  {}                                          → InstalledAgent[]
agent.registry              { refresh? }                                 → AgentRegistryList
agent.install               { id }                                       → InstalledAgent
agent.add                   { id, name, command, args }                  → InstalledAgent
agent.remove                { id }                                       → Ack
agent.detect                {}                                           → DetectedAgent[]
agent.select                { projectId, agentId: string | null }        → Project
agent.refreshConfig         { sessionId }                                → ConfigOption[]
agent.authMethods           { agentId }                                  → AgentAuthMethod[]
agent.authenticate          { agentId, methodId, env? }                  → AgentAuthResult
agent.logout                { agentId, methodId? }                       → Ack
agent.answerElicitation     { response: ElicitationResponse }            → Ack
agent.providers             { agentId }                                  → AgentProvidersReport
agent.setProvider           { agentId, providerId, apiType, baseUrl, headers? } → Ack
agent.disableProvider       { agentId, providerId }                      → Ack
agent.jbcentral{Connect,Disconnect,StartProxy,Login,Update}  {}          → Jbcentral*Result
```

`SessionCreated` is named rather than inlined because `review.sendComment` / `review.sendBatch` answer
it plus one field (`reused`), and two hand-copied shapes would drift. **`agent.select` writes the
project override only**: the global default is `AppConfig.defaultAgentId`, written through
`settings.update` and broadcast on `settings.changed`, so each field has exactly one writer.
`DetectedAgent` is what the Settings → Agents "found here" rows render: the registry identity
(`id`, `name`, `icon?`) plus the launch the host resolved (`command`, `args`) and how it was found —
`source` is `path` when the executable was located on `PATH` or a user-local bin dir and `npx`/`uvx`
when the runner's package was already installed globally, with `detail` carrying the evidence to show
under the name (the absolute path, or the pinned `pkg@version`). It carries **no version**: the
registry's version describes the archive an install would have fetched, not the binary that is
actually on this machine.
`AgentProvidersReport` replaces `ProviderStatusReport` — it carries the agent's providers plus the
JetBrains Central state, which is host knowledge (Central runs on the host, and its install command
reflects the *host's* OS, which may be a remote machine). `agent.setProvider` is the only place a
credential-bearing `headers` map exists, and it travels client→host only; `agent.providers` never
reads one back.

`ServerWelcome` carries **two** version numbers: `protocolVersion` (this wire) and
`agentProtocolVersion` (what the host negotiated with `defaultAgent`, `null` before it reaches one). A
control can be missing because the host is older than the UI or because the agent speaks an older
agent protocol, and one number cannot tell those apart. `defaultAgent` is the agent a new chat starts
on when its project names no override; `null` means the host has no usable agent at all, which is what
the Welcome screen's "install an agent" fork reads.

### What each method promises

`Ack` is the wire result for a method that returns nothing meaningful — the host coerces a void handler
to it.

- **`session.create`** resolves the agent host-side: the project's override, else the global
  `AppConfig.defaultAgentId`, else the bundled one, so no client has to know that precedence. It
  **rejects** when the resolved agent cannot be started (binary missing, protocol refused) — a tab is
  never opened onto a dead process.
- **`session.delete`** ends the chat if it is live, then moves its transcript to the OS trash, so the
  delete is recoverable.
- **`session.getCommands`** is the read a *reconnecting* client repopulates the `/` menu from: commands
  describe a running process and are deliberately not in the durable record, so there is nothing to
  replay them from.
- **`session.answerPermission`** addresses the awaiting request by `decision.id`; a decision for a
  prompt the agent already withdrew is **rejected rather than parked**.
- **`session.getMessages`** re-opens the session when it is not already live, so `summary` and
  `capabilities` describe a running agent rather than a disk record.
- **`agent.list`** lists `unavailable` rows rather than hiding them: "your agent's binary is gone" is an
  answer, and a silently shorter list is not.
- **`agent.registry`** serves a cached document unless `refresh` forces a re-fetch, and a failed fetch
  always degrades to `stale: true` — the last good document, rendered with a staleness note, **never**
  grounds for concluding that an agent missing from it has been withdrawn.
- **`agent.install`** fetches one registry agent into the host's data dir, pinned at the entry's
  version, and answers the resulting catalog row; re-running it on an installed agent is the Update
  action.
- **`agent.add`** is the wire half of `thinkrail agent add`: it registers an ACP agent already on this
  machine as an `external` catalog row and answers that row. It **refuses the bundled agent's id**, an
  id already registered (the Update path is `agent.install`, and re-pointing an existing row is a
  remove-then-add so the user sees what changed), an empty id and an empty command; a blank `name`
  falls back to the id, exactly as the CLI does. The four fields are the whole surface — they are also
  the four fields a user can see and edit in the form — so an agent needing `env` to start is an
  install, not an add.
- **`agent.remove`** forgets one catalog row, deleting the directory an archive install owns and
  nothing else. It **refuses the bundled agent** (it is not in the catalog and is the fallback every
  other resolution ends at) and names an unknown id rather than answering `ok` for a no-op. It
  deliberately **does not rewrite any `Project.agentId` or `AppConfig.defaultAgentId` that pointed at
  it**: per [[architecture]] Decision #20 those are opaque ids resolved against the installed catalog,
  so the dangling id surfaces as a clear "No agent named X is installed." the next time a chat starts,
  instead of silently moving every chat in that project onto a different agent.
- **`agent.detect`** answers the "Found on this machine" rows of Settings → Agents: the curated
  shortlist ([[submodule-acp-registry]]), filtered to what actually resolves here and is not already
  registered. Result rows are one-click `agent.add` payloads — `command` is the absolute executable
  the probe resolved and `args` come from the registry entry, so the client posts them back unchanged.
  An empty array means "nothing recognised here", never "detection is unavailable"; the install picker
  (`agent.registry`) is the path for everything else.
- **`agent.authenticate`** runs one auth method. `env` carries the values an `envVar` method asked for
  and travels **client→host only** — the host passes them to the agent process and never echoes them
  back. An `agent` method may ask the user through `agent.elicitation` while this is in flight; a
  `terminal` method answers with the workspace terminal the host opened the agent's own login TUI in,
  which the client then attaches to.
- **`agent.logout`** narrows to one method with `methodId`; omitted, it signs the agent out entirely.
- **`agent.answerElicitation`** carries `declined` / `cancelled` too, so a dismissed dialog settles the
  agent's awaiting request instead of hanging its turn.
- **`agent.disableProvider`** is rejected for a provider the agent marked `required`.
- **`AgentProvidersReport.centralInstallCommand`** is the host's per-OS install command for the
  JetBrains Central CLI, rendered when Central is absent or outdated.
- **`agent.elicitation`** is session-less on purpose — an agent may ask during auth or configuration,
  before any chat exists — so `request.sessionId` is what scopes a frame, not the channel.
  `agent.permission` is always session-scoped.
- **`agent.changed`** is deliberately **non-replayable**: reconnect reads (`agent.list`,
  `agent.providers`) repair any transition missed with a socket. **Every catalog mutation publishes
  it** — `agent.install`, `agent.add` and `agent.remove` alike — because the agent list, the detection
  rows and the default-agent badge are all derived from that one file.
- **`ReviewSendResult`** answers which chat the review package went into plus the one fact only the host
  knows — whether that chat was **reused** (a file's earlier review chat, followed up into) or created
  by this call. On `reused` the client must take the hydration path: opening such a session as if it
  were new gives it an empty runtime, landing the user in a blank conversation whose comments already
  read as sent. `review.sendBatch` answers **every** session it touched, in group order — a batch
  spanning two files starts two chats, and naming only one leaves the other invisible while its comments
  already read as sent.

### `domain.ts` under an agent-free wire

`Project.agentId` and `AppConfig.defaultAgentId` are Decision #20's two fields. `Project.agentId`
overrides the global default and absent means follow it; the override is per **project**, not per
workspace, because a repo's agent is a property of the codebase and picking one per worktree would make
two branches of the same repo answer differently for no reason a user could predict.
`AppConfig.defaultAgentId` is `null` until one is chosen, and the host then falls back to its bundled
agent. Both are opaque ids the host resolves against its installed catalog: a config naming an agent
that has since been removed must fail at the point of use, not silently re-point every chat somewhere
else. `Session` is the chat tab — `id` is the UI tab id, `sessionId` the agent's session id. Search
hits address a message by `MessageId`, not by position — `PromptHit.messageId` / `MessageHit.messageId`,
each paired with an `anchorText` prefix that lets a client validate or fall back when the live
transcript has drifted from the indexed record. Both are optional only for tolerance; a current host
always sets them together. Deleted:
`ProviderStatus`, `ProviderAuthKind`, `ProviderStatusReport` (providers are agent-scoped now) and
`LoginFrame` / `LoginPush` / `LoginReply` (the multi-frame login stream is replaced by elicitation and
terminal-hosted auth). Every `Jbcentral*` type survives unchanged.

## Genuinely lost, stated so no spec claims otherwise

The extension-UI `setStatus` / `setWidget` frames (header status entries, composer widget strip) —
Decision #6 bounds `_meta` to retry, compaction, queue depth and steering, and these have no ACP
carrier; `notify` survives as a durable `notice` marker. Command provenance for external agents. Per-
model `contextWindow` / `reasoning` sub-lines for agents that do not report them. The multi-frame login
stream — interactive auth is elicitation or an `AuthMethodTerminal` in a real PTY, which is why
`AgentAuthResult` has a `terminal` outcome. The committed-skills trust gate as a *guarantee* for
external agents; the floor is that we control which directories the agent is pointed at.

## Dead weight dropped rather than translated

`session.compact`, `session.dispose`, `session.getStats`, `session.extUiReply`, `model.*`, `provider.*`,
`queue_update` text payloads, `session_info_changed`, `summarization_retry_attempt_start`,
`bash_execution_update`, `SessionStats.*`, `AskUserQuestionAckDetails`, `WireCustomMessage`,
`WireCompactionSummary`, `TranscriptMessage`, `isTranscriptMessageRole`, `ASK_USER_ANSWERS_CUSTOM_TYPE`
/ `AskUserAnswersMessage` / `isAskUserAnswersMessage`.

## Boundary tests

`src/boundary.test.ts` reads every source file here and asserts that no specifier leaves the package —
a *type-only* import of an agent SDK is the way this property dies, and `verbatimModuleSyntax` erasing
it at runtime hides the coupling rather than removing it. The same file pins the manifest (no
dependencies, devDependencies exactly `typescript` + `@types/bun`), forbids any host-runtime name, and
holds `WS_METHODS` and `WsMethodMap` in exact correspondence — a type-level assertion, because
`WsMethodMap` does not exist at runtime, so `bun run typecheck` is the only witness. It also asserts
every method and channel string is distinct.

`packages/acp/src/boundary.test.ts` is the mirror on the producing side, and
`packages/acp/src/translate/assembler.test.ts` with `packages/server/src/transcript/fold.test.ts` are
the other half: together they pin ACP `SessionUpdate` → `ChatEvent` → durable log → replayed fold.

## Non-goals

Validation. These are types plus a few shared constants; runtime validation of untrusted wire data
belongs to whoever reads it. The guards kept here exist because both ends must agree on one reading.
