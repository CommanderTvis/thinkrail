---
id: submodule-acp-translate
type: submodule-design
status: draft
title: translate — ACP shapes to ThinkRail shapes
parent: module-acp
depends-on: [module-contracts]
covers: [acp-engine-boundary]
tags: [v1, acp]
---

## Responsibility

The only place in the repo where an ACP shape becomes a ThinkRail shape, and back. Session updates
become `ChatEvent`s, ACP tool calls become `ToolCallBlock`s, content blocks become `PromptContent`.

## Boundary

- **Owns:** every mapping decision — block ordering, tool-name resolution, status and stop-reason
  vocabularies, config-option categories — and the per-session assembler that reconstructs an ordered
  block array from independent chunk streams.
- **Public surface (barrel):** `SessionAssembler` + `AssemblerClock`; `toPromptContent`, `toChatBlock`,
  `toContentBlocks`, `toToolOutput`; `toToolCallBlock`, `toToolCallPatch`, `synthesizeToolCall`, `toToolName`,
  `toToolKind`, `toToolStatus`; `ancillaryEvents`, `metaEvents`; `settlementFromResponse`,
  `settlementFromError`, `describeError`; `toConfigOptions`, `toSetConfigOptionRequest`, `hasCategory`;
  `toSlashCommands`; `toAgentPlan`; `toAgentProviders`, `toSetProviderRequest`;
  `usageFromUpdate`, `toTokenUsage`, `addTokenUsage`, `toMoney`;
  `toElicitationRequest`, `toElicitationOutcome`; `toPermissionRequest`, `toPermissionOptions`,
  `toPermissionOutcome`; `asEpochMs`, `asRecord`, `asString`, `UnknownRecord`. **Not re-exported from
  the package barrel, by rule.**
  `asEpochMs` is the one structural guard that is also a *mapping* — ACP reports ISO 8601 and every
  ThinkRail timestamp is epoch ms — so it is published rather than re-implemented by each sibling that
  reads a protocol timestamp. `asRecord`, `asString` and `UnknownRecord` are published for the
  one-owner reason instead: reading an unknown JSON value as a record or a string is the same operation
  on a captured frame as on an ACP payload, so `testing` reads them from here rather than declaring a
  second copy that could drift on the day one of them learns about `null` or an array.
- **Allowed deps:** `@agentclientprotocol/sdk` (types), `@thinkrail/contracts` (types), sibling `meta`;
  sibling `testing` **from a `.test.ts` only**, for the published JSON schema it reads.
- **Forbidden:** every other sibling; any process, clock, filesystem, network or random source. No
  source file here reaches `testing` — that would put a devDependency and the whole schema document
  in the binary.

## Decisions

- **Structural reads, typed signatures.** See the parent spec for why.
- **ACP has two kinds of union and each gets a different exhaustiveness gate.** A union the protocol
  declares *closed* (`ContentBlock`, `ToolCallContent`, `SessionUpdate`, `ToolKind`, `ToolCallStatus`,
  `StopReason`, `PermissionOptionKind`, `PlanEntryStatus`, `PlanEntryPriority`) still arrives as bytes,
  so a dispatch first narrows the wire value through `isVariant` against a table whose *type* is a
  mapped type over the SDK's union: an SDK bump that adds a variant fails to compile at the table, and
  the `default` branch is then unreachable and reads `assertNever`. A union the protocol declares *open*
  — `ElicitationPropertySchema` and `SessionConfigOptionCategory` each carry an explicit `other` member,
  and the former's says a client MUST NOT render an unknown type as a known control — has no closed type
  to check against; its table is `as const`, its fallback is the point rather than a leak, and the only
  gate that can exist is the runtime one in `exhaustiveness.test.ts`. The third shape is a closed union
  behind a *public* signature: `ancillaryEvents` takes a `SessionUpdate` and cannot assume the
  assembler's guard ran, so its `default` is `unhandledVariant` — the same compile-time `never`, but
  degrading rather than throwing on the notification path.
- **`assertNever`, `unhandledVariant` and `isVariant` live in `guards.ts`** with the structural readers,
  because `capabilities` dispatches on its own closed unions too and `capabilities → translate/guards`
  is already the one sanctioned cross-sibling reach. Each declared-variant table is exported from the
  file that dispatches on it, but not from the barrel: they are the gate's input, not public surface.
- **The assembler takes its ids and its clock as an injection** (`AssemblerClock`). Every translation
  is then deterministic and unit-testable with no process at all, and the ids the assembler mints are
  the ids the host's transcript stores — one authority, no mapping table between an agent's message
  ids and ThinkRail's. One instance per session; every method *returns* the events to publish, so the
  assembler owns no sink, no clock of its own and no I/O.
- **`beginTurn` opens the user message and returns its id**, which `session.prompt` answers with, so the
  composer replaces its own echo by identity instead of matching text. The first user-chunk group of the
  same turn re-announces that id — an in-place upgrade, not a second bubble.
- **`ContentChunk.messageId` is optional and nullable, and absent means "the agent does not group".**
  Chunks then keep flowing into the open message of that role rather than each opening its own.
- **Empty text chunks open nothing.** A zero-length chunk would leave an empty markdown row and a
  spurious `writing` phase.
- **A chunk of a different kind opens a new block**, as does a tool call, an image or a resource. That
  is what makes a routine activity run contiguous and what breaks it when the agent answers in between.
- **Tool calls carry no message id in the protocol**, so they join the open assistant message, opening
  one when none is open. A re-announced `tool_call` is an update, not a second row.
- **`tool_call_update` for an unseen id synthesises the call.** Agents get ordering wrong; a lost tool
  row is worse than a synthesised one titled by its id.
- **`toToolCallPatch` is field-wise REPLACE and carries only the fields the agent actually sent**, so an
  update bearing just a status never blanks the title, the arguments or the locations. `content` is the
  one collection ACP documents as replacing wholesale, which is also our wire's rule.
- **`settle()` sweeps dangling calls to `abandoned`, not `error`** — only the host can tell "failed"
  from "the turn outran it", and they read differently to a user. The sweep is emitted *before*
  `turn_settled` so no card can spin past the settlement, which is what replaces a renderer reaching
  across messages for a stop reason. `toToolStatus` maps ACP's four states onto ThinkRail's five and
  never mints `abandoned` itself; all four are named in its table, and a status the agent omits or
  spells unknown reads as `running`, the one value that keeps the card alive until the sweep can end it.
  `reset()` drops all in-flight state, for a connection replaced under a live session.
- **The tool-name fallback is namespaced (`acp:<kind>`) and claimed by no built-in renderer.**
  `ToolCall.name` is UNSTABLE, optional and nullable upstream while the whole renderer registry
  dispatches on it, and guessing `bash` from a title would point the bash card at a `rawInput` with no
  `command` field — a silent failure that looks like a rendering bug. `ToolKind` is likewise typed
  closed but arrives over a wire: anything unrecognised is `other`.
- **`rawInput` is adopted only when it is a plain object.** It is `unknown` and
  `x-deserialize-default-on-error` upstream; a card's `strArg` helper must never see a scalar.
- **A variant ThinkRail cannot render (today `audio`) maps to `undefined`, never to an empty text
  block.** Fabricating one is what renders a pasted screenshot as an empty bubble. It is an explicit
  `case`, not a fallthrough: ThinkRail has no audio surface today, and the day ACP adds a block that
  *should* render, the missing case has to break the build instead of joining `audio` in one silent
  branch. `image` maps through the same function rather than being filtered out, and `toChatBlock` is
  that function typed at the SDK boundary so a caller can pass a real `ContentBlock`.
- **A resource with inline text goes out as an embedded `resource`, one without as a `resource_link`.**
  That is the only signal an agent has for whether it still has to read the file itself.
- **A tool's `diff` and `terminal` outputs travel structurally, not flattened to text** — both are
  richer than a diff hand-rolled out of `arguments`. `terminalId` doubles as the workspace tab key,
  because the host mints one string for both when it serves `terminal/create`, so nothing here has to
  know about workspaces or tabs.
- **`ancillaryEvents` covers every `session/update` variant that carries no message state.** The
  message and tool variants belong to the assembler because they need its open-message cursor; these
  are pure per-notification maps, and an unrendered variant yields nothing rather than an empty frame.
- **A `session_info_update` with neither `title` nor `updatedAt` publishes nothing.** It is the no-op
  carrier ThinkRail's `_meta` signals ride on, and an empty frame would churn the tab strip.
- **`metaEvents` reads a notification's `_meta` for the four signals ACP cannot express** (Decision
  #6). A malformed payload yields nothing rather than throwing into the notification stream.
- **One selector mechanism, not three bespoke wire methods.** ACP's session config options are what the
  model picker, the effort picker and the mode picker all render. An empty group list is a meaningful
  state: the pill is absent, not disabled. `hasCategory` is what drives the picker flags, and
  `toSetConfigOptionRequest` covers the one set method's two param shapes (boolean vs select).
- **The config-option projection is an allowlist, not a spread:** id, name, description, and per-choice
  id/name/description. A future upstream field — or an agent stuffing a credential-bearing URL into an
  option's `_meta` — is excluded by default rather than inherited onto a client-visible frame.
- **A flat select list becomes one group with `name: null`.** The picker has no ungrouped branch.
- **`toAgentProviders` reads `current`'s presence, not its truthiness, for `configured`** — ACP states
  null and omitted both mean disabled, and a provider whose `providerId` cannot be read structurally is
  dropped outright rather than surfaced with a fabricated id, the same rule `authMethods` (owned by
  `capabilities`, which reads `initialize.authMethods` the identical structural way) already applies to a
  method with no readable `id` or `name`. `name` is never populated: ACP's `ProviderInfo` carries none.
  `toSetProviderRequest` needs no guard at all, unlike every reader above it — its input is ThinkRail's
  own already-validated routing, not wire bytes, so it is a plain field copy, the same shape
  `toSetConfigOptionRequest` already is for the same reason.
- **`current_mode_update` produces no event** — a mode change republishes the config set; carrying both
  would reinstate two mechanisms for one picker.
- **ACP has no provenance field on a command**, so `source` / `sourceInfo` stay unset and the
  provenance chip is absent for external agents; the host layers its own prompt templates on top, where
  it does know.
- **An agent's plan is never merged into ThinkRail's own todo plan.** It is flat, agent-owned and
  replaced wholesale; the merge would produce a plan the user can edit and the agent silently
  overwrites. Its statuses map onto the todo vocabulary so one renderer serves both panes, and the
  UNSTABLE `markdown` / `file` variants carry no entry list, so they yield an empty plan rather than a
  fabricated one.
- **The two plan variants carry their entries at different depths and both are read.** `plan` is a
  `Plan` (`entries` at the top level); `plan_update` is a `PlanUpdate` whose `plan` is a
  `PlanUpdateContent` (`entries` nested one level down, under `type: "items"`). Reading only the top
  level would answer every `plan_update` with an empty plan — which the panel shows as the agent having
  wiped its own plan.
- **`plan_removed` maps to `{ type: "plan", plan: null }`**, so the web store needs no removal case.
- **Usage is accumulated, never recomputed.** ACP reports context size on `usage_update` but tokens
  **per turn**, while the stats strip shows a session total — so the fold lives here (`addTokenUsage`)
  and the caller passes the folded half in, rather than each call site re-deriving it. Absent counters
  stay absent instead of becoming `0`, and cost carries its own currency: nothing assumes USD or
  normalises between currencies.
- **`failed` is ThinkRail's own stop reason and this is where it is minted.** ACP has no error stop
  reason — an agent failure is a JSON-RPC error — and its own stop reason is per turn, which is what
  our wire records. The message survives verbatim rather than being flattened to "request failed",
  because it is what the persistent failure banner shows, live and after a reload.
- **The SDK's `RequestError` is duck-typed, not matched with `instanceof`.** Bundling can produce two
  class identities for it, and a silently unmatched error would lose the provider's own text.
- **An unrenderable elicitation is declined, not dropped.** The schema forbids rendering an unknown mode
  as a known one, and an agent blocked on a dialog that will never appear is a hung turn. Coming back
  the other way, `cancelled` is an explicit outcome rather than the fallthrough: `cancel` and `decline`
  are different answers, and a future ThinkRail outcome swept into `cancel` would tell the agent the
  user dismissed a form they had in fact answered.
- **An unrenderable form *field* declines the form only when the schema marks it required.** An `accept`
  missing a value the agent was promised is a wrong answer, which is worse than no answer; an optional
  one is dropped instead, costing the agent a hint rather than the reply. A boolean field carries no
  `required` at all — a checkbox always has an answer.
- **Both spellings of a closed set are read:** `oneOf` / `anyOf` carry a title per value, a bare `enum`
  carries only the values and labels itself with them.
- **A form elicitation and a permission prompt are correlated by an id the caller mints**, from the
  connection's clock, because ACP correlates both by JSON-RPC request id and nothing outside this
  package can hold one. A URL elicitation is the exception: it carries its own id and
  `elicitation/complete` later names it, so that id wins.
- **An unrecognised permission-option kind fails closed to `rejectOnce`.** The kind picks the button's
  tone and whether the answer is remembered, and the agent's own `optionId` travels back either way — so
  the only thing a wrong guess changes is how dangerous the button looks, and guessing "allow" is the
  guess that misleads.
- **A permission prompt's call is *synthesised* from `toolCall`,** the same way an orphan
  `tool_call_update` is: agents routinely ask before announcing the call, and a prompt with no card to
  sit on is worse than a card assembled from the request.

## Tests

`assembler.test.ts` pins block interleaving, message boundaries by agent message id, empty-chunk
suppression, the synthesized tool name, synthesis from an orphan update, the abandon sweep at settle,
and the echo upgrade. With `packages/server/src/transcript/fold.test.ts` these pin the whole chain: ACP
`SessionUpdate` → `ChatEvent` → durable log → replayed fold.

`elicitation.test.ts` pins every property-schema kind onto its field, both spellings of a closed set,
the required-vs-optional rule for an unrenderable field, which id wins per mode, and the outcome map.
`permission.test.ts` pins the option-kind map and its fail-closed fallback, the dropped id-less option,
the synthesised card, and the outcome map. Both build their payloads as bytes off a wire rather than as
SDK literals — that is what exercises the structural readers instead of the type checker.

`providers.test.ts` pins `toAgentProviders` against a populated `current` versus a `null` one, an
omitted `current`, a missing `supported` list (protocols empty, provider still reported), and an entry
with no readable `providerId` (dropped, not defaulted); and pins `toSetProviderRequest`'s round trip
with and without `headers`. `capabilities/negotiate.test.ts` carries the matching coverage for
`authMethods` — every `AuthMethod` variant, the unrecognised-`type` fallback to `agent`, and a dropped
malformed entry — because that function lives in `capabilities`, not here (see that module's SPEC).

`exhaustiveness.test.ts` is the runtime half of the gate above: for each vocabulary it compares the keys
of the declared-variant table the translator actually dispatches on against the `const` values the
published schema declares, read through `testing`'s `schemaVariants`. It is the *only* gate for the two
open unions, and for the closed ones it catches the case the type system cannot — an SDK whose
`types.gen.d.ts` and whose `schema.json` have drifted apart.
