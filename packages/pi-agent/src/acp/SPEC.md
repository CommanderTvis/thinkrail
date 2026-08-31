---
id: submodule-pi-agent-acp
type: submodule-design
status: draft
title: acp — the agent-side face on pi
parent: module-pi-agent
depends-on: [submodule-acp-meta, module-contracts]
references: [module-acp, submodule-pi-agent-engine]
covers: [first-party-pi-agent, client-side-delegation, thinkrail-meta-namespace]
tags: [v1, acp, pi]
---

## Responsibility

Everything that makes the `engine` sibling look like an ACP **agent**: the `initialize` handshake and the
capability record it advertises, the request handlers for the session lifecycle, the translation of pi's
`EngineEvent` stream into `session/update` notifications, the questionnaire and extension dialogs routed
through `elicitation/create`, and the pi tools rebuilt on top of the client's `fs/*` and `terminal/*`.

This is the mirror image of `packages/acp`: same protocol, other end of the pipe. Nothing here decides
what pi does — it decides what pi's behaviour *looks like* on the wire.

## Boundary

- **Owns:** the `AgentApp` and its handler table; `AgentCapabilities` and the advertised ThinkRail
  `_meta` extension list; the `EngineEvent` → `SessionUpdate` translator and its per-session message-id
  minting; the ACP↔pi content mapping in both directions; the `ToolKind`/title/location derivation; the
  elicitation schemas for the questionnaire and for pi's `uiContext` dialogs; the delegated tool
  operations; the per-session prompt-settlement registry.
- **Public surface (barrel):** `createPiAgentApp` — the only thing the package entry needs. The rest is
  exported for the sibling composition root and for tests: `PI_AGENT_CAPABILITIES`,
  `PI_AGENT_EXTENSIONS`, `PI_AGENT_INFO`, `readClientCapabilities` + `NegotiatedClient`/`OFFLINE_CLIENT`;
  `configOptionsFor` + the option ids and value-id codec; `toPiPrompt` / `toolResultContent` /
  `partialResultContent`; `delegatedToolDefinitions` + `DelegationTarget`; the elicitation codecs;
  `SessionTranslator` / `toStopReason`; `SessionRegistry`; the tool-kind derivation.
- **Allowed deps:** `@agentclientprotocol/sdk`; `@thinkrail/acp/meta` (the shared `_meta` namespace, and
  the **only** thing this module may take from `@thinkrail/acp` — the rest of that package is the client
  half); `@thinkrail/contracts` (types only); the `engine` sibling **through its barrel**;
  `@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai` (types, and the tool-definition factories
  the delegation rebuilds).
- **Forbidden:** `@thinkrail/acp`'s root or `testing` subpaths; `@thinkrail/server`, `@thinkrail/shared`,
  `apps/*`; reaching into `engine`'s files past its `index.ts`; any filesystem, git or worktree
  knowledge — the `cwd` arrives on `session/new`.

## Decisions

- **Everything ACP stops here.** `engine` never sees a protocol type and `acp` never touches pi state
  except through the engine barrel, so an upstream SDK break is an edit to this directory. That mirrors
  [[architecture]] Decision #19 on the client side, for the same reason: much of the surface this module
  leans on — elicitation, `ToolCall.name`, `providers/*`, `Usage` — is marked UNSTABLE upstream.
- **Message ids are this translator's, not pi's.** ACP groups chunks by `messageId` and pi's event
  stream has no such id; the translator mints `<sessionId>:m<n>` on each `message_start` and stamps
  every chunk of that message with it. They are opaque to the client, which only ever asks whether two
  chunks share one.
- **The three write modes are produced, not re-derived.** A `text_delta`/`thinking_delta` becomes an
  appending chunk; a tool call arrives complete as a `tool_call`; everything after it is a
  `tool_call_update` naming only the fields that changed. Nothing here ever re-sends a whole message.
- **A tool call announced by the model is upgraded, not re-announced.** pi emits `toolcall_end` on the
  assistant message and *then* `tool_execution_start` for the same id. The first is a `tool_call` with
  status `pending`; the second, recognised by the id already being known, is a `tool_call_update` to
  `in_progress`. Emitting a second `tool_call` would make the client show the card twice.
- **pi's extra signals ride `_meta` on a no-op `session_info_update`.** Attempt-level retry, compaction
  lifecycle and queue depth have no ACP vocabulary and no method of their own; they travel as
  `SessionNotification._meta` payloads under the shared `dev.thinkrail.v1` key, in order against the
  chunks around them, on an update whose every field is optional — so a conforming client that does not
  know ThinkRail ignores it entirely. `initialize` advertises exactly the four the agent actually emits
  or honours: `retry`, `compaction`, `queue`, `steering`. `skills` and `templates` are **not**
  advertised, because the `_ext` methods that would serve them are not implemented.
- **Steering is honoured, not emulated.** A `session/prompt` carrying `_meta.steer.mode` routes to pi's
  `steer` or `followUp` queue instead of being rejected or held. `promptSession` resolves the mode
  against the session's *live* `isStreaming`, so a race between the host's belief and pi's state cannot
  park a message forever.
- **`session/prompt` resolves when pi settles, and an error is a JSON-RPC error.** The registry hands
  out a promise per prompt that the `agent_settled` event resolves with pi's terminal metadata; a
  `stopReason` of `error` is re-thrown as `internalError` carrying pi's own message, because ACP's
  `StopReason` has no failure member and reporting `end_turn` for a failed turn would be a lie.
- **Config options are read from the session, never from defaults.** `getSessionConfig(sessionId)` is
  what backs both the `session/new` response and every `config_option_update`; the model list is grouped
  by provider into one `model`-category select, and the `thought_level` select is **absent** when the
  current model declares a single thinking level rather than present-and-useless.
- **A model value id is `provider + "/" + id`, split on the first slash.** Model ids contain slashes
  (`openrouter/anthropic/claude-…`); splitting on the last one, or joining with a character that could
  appear in either half, would silently mis-resolve exactly the aggregator providers users reach for.
- **`mcpServers` is refused, never accepted-and-dropped.** The agent advertises
  `mcpCapabilities {http:false, sse:false, acp:false}` and ThinkRail's own tools are registered natively
  by `engine` ([[architecture]] Decision #17), so a non-empty `mcpServers` on `session/new` fails with
  `invalidParams` naming the servers. Silently storing and ignoring them is the precise defect that
  disqualified the community `pi-acp` (Decision #14); repeating it here would be worse.
- **Nothing is pushed for a session the client has not been told about yet.** The commands and usage a
  fresh session already knows are published on the next macrotask, after `session/new` (or
  `session/load`) has answered — a `session/update` naming a `sessionId` the client has not yet received
  is one a conforming client is entitled to drop. `config_option_update` follows the same rule from the
  other side: it is pushed when pi changes the level *itself* (`thinking_level_changed`), while a
  client-driven `session/set_config_option` gets its answer in the response.
- **`uiContext.notify`'s level is dropped, not smuggled.** pi's extension notices reach the client as
  plain agent message chunks. The level would need a `notice` field in the shared
  `@thinkrail/acp/meta` namespace — round-3 Decision #17 keeps `notify` as a durable `notice` marker —
  and inventing a private `_meta` key here would produce a payload the client's reader cannot parse and
  would silently discard. Absent beats unreadable.
- **A closed session cancels its turn, it does not finish it.** `SessionRegistry` settles every waiting
  prompt with `aborted` when the session is dropped or the connection is lost, so `session/prompt`
  answers `cancelled`. Answering `end_turn` would tell the host a turn completed that never ran.
  `session/cancel` for a session that is already gone is a no-op — pi's `abort` throws *synchronously*
  for an unknown id, and a throw out of a notification handler has nowhere to go.
- **`providers/list` reports pi's own api ids verbatim.** ACP's `LlmProtocol` names five protocols and
  then admits any string; pi's vocabulary is its own (`openai-completions`,
  `bedrock-converse-stream`). Guessing a mapping onto ACP's five would be a lie the client cannot
  detect, while an unrecognised string is exactly what that escape hatch is for.
- **Usage is reported, never recomputed.** `usage_update` carries pi's own `contextUsage.tokens` and
  `contextWindow` and its own cumulative cost, tagged `USD` because that is the currency pi's model
  catalogue prices in. Nothing here converts or derives.
- **No `plan`.** pi has no plan stream of its own; its nearest equivalent is the `todo_*` tools, which
  are already ThinkRail's *workspace* todos. Round-3 Decision #18 keeps the agent's plan and the
  workspace todos separate and un-merged, so publishing the todos as an ACP `Plan` would render one list
  twice and invite exactly the sync the decision forbids.

## Delegation ([[architecture]] Decision #18)

`delegation.ts` rebuilds pi's four built-in file/shell tools on the client's methods, using pi's own
injectable `ReadOperations`/`WriteOperations`/`EditOperations`/`BashOperations` seams — so the tool's
schema, prompt contribution, truncation, diffing and rendering all stay pi's, and only the I/O moves.

- **Per capability, not all-or-nothing.** `read` delegates on `fs.readTextFile`, `write` on
  `fs.writeTextFile`, `edit` on both, `bash` on `terminal`. A capability the client does not advertise
  leaves that tool on pi's local default.
- **The set is replaced whole.** pi's `noTools: "builtin"` switch disables `read`/`write`/`edit`/`bash`
  together, so all four definitions are always supplied — the un-delegated ones rebuilt with the same
  settings pi would have used (`images.autoResize`, shell command prefix, shell path). Getting that
  wrong would silently drop three tools.
- **`grep`, `find` and `ls` stay local**, and are not in the `noTools: "builtin"` set. They are reads
  whose results the client has no method to serve, and V1's agent runs on the same machine as the host —
  delegation here buys visibility (unsaved buffers, watchable terminals), not isolation.
- **Bash streams by polling `terminal/output` against a byte offset** while `terminal/wait_for_exit` is
  outstanding, because ACP has no output notification. Abort maps to `terminal/kill` — including when
  the signal is *already* aborted on entry, which `addEventListener` would silently never fire — and the
  terminal is released in a `finally` so a throw cannot leak one. A terminal that exits on a signal
  reports `exitCode: null` rather than a fabricated `0`.
- **An unbound session refuses.** If the connection is gone or the `SessionToolBinding` is unfilled, the
  operation throws rather than falling back to the local filesystem: a silent fallback would write
  outside the delegation the client asked for.

## Tests

`updates.test.ts` pins the translation table — shared message ids within a message and a fresh one
across messages, thinking vs text, the announce→upgrade path for tool calls, and the three `_meta`
signals landing on a no-op `session_info_update`. `configOptions.test.ts` pins the slash-containing
model id round-trip and the absent thinking select. `elicitation.test.ts` pins the questionnaire schema
shape and every answer kind including decline. `sessions.test.ts` pins delete-without-open and the cancelled settlement on close and on
disconnect. `delegation.test.ts` pins the exact client calls each
operation makes, the already-aborted signal, the released terminal, and the unbound-session refusal —
it drives a fake `DelegatedClient`, which is why `DelegationTarget` names that narrow interface rather
than the SDK's `AgentContext` class.

## Later

`session/load` attaches the session and answers, but does **not** replay the conversation as
`session/update` notifications the way ACP asks an agent to. ThinkRail does not need it — the host owns
the transcript ([[architecture]] Decision #15) — but any other client would, and it is the one thing
standing between this package and being publishable. Provider login is the other: `providers/*`
configures a provider for the running agent only, and there is no login/logout path at all (see
`module-pi-agent`).

`NoticeLevel` needs a home. Adding `notice` to `ThinkRailMeta` in `@thinkrail/acp/meta` is the obvious
one — both ends already share that namespace — and would let the host mint the wire's `NoticeMarker`
from what pi actually said instead of guessing `info`.
