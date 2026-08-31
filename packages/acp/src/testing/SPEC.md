---
id: submodule-acp-testing
type: submodule-design
status: draft
title: testing — protocol conformance, frame capture, deterministic replay
parent: module-acp
depends-on: [module-contracts]
references: [submodule-acp-translate, submodule-acp-connection]
covers: [acp-engine-boundary]
tags: [v1, acp, verification]
---

## Responsibility

Evidence that ThinkRail reads the Agent Client Protocol the way its authors wrote it down, against an
artifact we did not author: the SDK's own `schema/schema.json`. Three pieces serve that one claim — a
validator compiled from that schema, a recorder that captures the JSON-RPC lines of a real session,
and a replayer that drives captured or committed frames back through `translate`'s assembler with no
process and no network.

## Boundary

- **Owns:** the frame vocabulary (`FrameRecord`, direction, kind, request/response correlation); the
  ajv setup and the schema queries `validateFrame` / `schemaVariants` answer; **the table naming every
  protocol vocabulary ThinkRail translates and the `$def` each one lives in**; the JSONL recording
  format and the `SpawnedProcess` decorator that produces it; the replay driver and its deterministic
  clock; the committed fixture corpus in `fixtures/` and its loader. `fixtures/` is **data owned by
  this module**, not a sub-module of it: it holds no code and no barrel, and `fixtures/README.md`
  documents its format, its limits and how to capture a real corpus.
- **Public surface (barrel, published as `@thinkrail/acp/testing`):** `validateFrame`,
  `schemaVariants`, `vocabularyVariants`, `PROTOCOL_VOCABULARIES`, `PROTOCOL_VOCABULARY_NAMES`,
  `FrameToValidate`, `FrameValidation`, `ProtocolVocabulary`, `SchemaVocabulary`; `classifyFrames`,
  `parseFrame`, `ClassifiedFrame`, `FrameDirection`, `FrameKind`, `FrameRecord`, `UnknownRecord`;
  `recordFrames`, `recordFramesFromEnv`, `recordProcess`, `jsonlFrameSink`, `ACP_RECORD_DIR_ENV`,
  `FrameSink`, `RecordFramesOptions`, `EnvBag`; `replayRecords`, `replayFile`, `readFrameRecords`,
  `deterministicClock`, `ReplayOptions`; `loadFixtures`, `FIXTURES_DIR`, `FixtureCorpus`.
- **Allowed deps:** `@agentclientprotocol/sdk` and its `schema/schema.json` export; `ajv/dist/2020`;
  `@thinkrail/contracts` (types); siblings `connection` and `translate`; `node:fs`, `node:path`.
- **Forbidden:** every other sibling — in particular `client`, `capabilities` and `registry`, whose
  behaviour this module never asserts; the host; the network. **Nothing outside `testing` may import
  it from a source file** — a test may.

## Decisions

- **The validator is compiled from the SDK's schema, not from a hand-copied one.** The point of the
  check is that it is an artifact we did not author. `@agentclientprotocol/sdk/schema/schema.json` is a
  declared export, so an SDK bump moves the schema under us — which is the intended failure.
- **The structural readers come from `translate`, not a second set declared here.** `frames.ts` owns
  what is specific to JSON-RPC framing — direction, kind, request/response correlation — and reads an
  unknown JSON value through `translate`'s own `asRecord` / `asString` / `UnknownRecord`. That is the
  same operation on a captured frame as on a live ACP payload, and two copies of it would drift.
- **`ajv` is a devDependency and only this sub-module may reach it.** It exists to compile a JSON
  Schema in a test, never to validate a live frame: `connection` already pays for the SDK's own zod
  parse, and adding a second parse to the hot notification path would double it. `boundary.test.ts`
  pins both halves of that — the dependency section and the import graph.
- **Unknown formats are registered, not disabled.** The schema names `uint64`, `uint32`, `uint16`,
  `int64`, `int32`, `double` and `uri`; ajv core ships none of them. Turning `validateFormats` off
  would silence the keyword everywhere, so each name the schema uses is registered as an
  always-true format instead — the numeric bounds those names imply are already carried by
  `type: "integer"` and `minimum`, so nothing is actually lost. The vendor keywords (`discriminator`
  and every `x-*`) are registered the same way, and both lists are **read out of the schema** rather
  than typed here, so an SDK bump that adds one cannot fail compilation.
- **A frame is checked twice: against its direction's union and against its method's own definition.**
  The unions alone are close to vacuous — `AgentNotification`'s `params` accepts `ExtNotification`,
  whose schema is the empty object, so *any* payload satisfies the union. The method-to-definition
  table is derived by walking each union for `$ref`s whose target carries `x-method`, so it is the
  schema's own answer to "what may this side send", not a list maintained here.
- **A method with no definition is an error, unless it is an extension.** A typo'd method that only
  ever met the union check would pass silently. Methods beginning `_` (ACP's extension convention) or
  `$` (the protocol-level `$/cancel_request`) are the deliberate exceptions.
- **`schemaVariants` throws when a definition or a discriminated union goes missing**, so a renamed
  `$def` fails loudly instead of reporting an empty variant set that every corpus trivially covers.
- **`PROTOCOL_VOCABULARIES` is the single answer to "which `$def` holds which vocabulary".** Two
  suites ask it — the corpus-coverage half of `conformance.test.ts` and `translate`'s
  `exhaustiveness.test.ts` — and a `$def` name spelled independently in each would let one suite keep
  passing against a definition the other had already renamed. The names tuple and the record are
  mutually gated by a mapped type, so a vocabulary added to one is a compile error until it is added
  to the other, and `translate`'s `TRANSLATED` table is keyed by the same mapped type: a new
  vocabulary cannot land without a translator table to compare it to.
- **The recorder wraps the `SpawnedProcess` seam and nothing else.** `connection` already takes a
  `ProcessSpawner`, so capture is a decorator over the spawner rather than a hook inside the
  connection — which is also why `connection` keeps no filesystem dependency. `spawnWithBun` is
  exported from `connection` for exactly this: the decorator wraps the real default rather than
  reimplementing `Bun.spawn`.
- **`recordFramesFromEnv` is inert without `THINKRAIL_ACP_RECORD_DIR`**, returning the spawner it was
  given unchanged. A composition root wires it once and unconditionally; from then on capturing a real
  session is an environment variable and nothing else.
- **A recorded line is one that parses as a JSON object.** `connection`'s hot-path filter tests only
  the opening brace, because re-parsing every line would double the cost of the stream it feeds. The
  recorder is off that path and can afford the parse, which is what guarantees every recorded line is
  replayable and keeps an agent's startup banner out of the transcript.
- **Frames are written with `writeSync` as they arrive.** The reason to record is usually a session
  that is about to die; a buffered writer would lose the last frames, which are the ones that explain
  it.
- **Replay reconstructs the assembler's stream, not the connection's.** It drives `session/prompt`
  requests, `session/update` notifications and prompt responses through one `SessionAssembler` per
  session id and folds turn usage the way `connection` does. It deliberately does *not* reproduce the
  `capabilities` events the connection widens by observation: those are derived from the capability
  record, not from frames, and a replay has no handshake.
- **Replay asserts the SDK's type at the wire boundary rather than re-validating.** The live path gets
  its `SessionNotification` from the SDK's own parse; a replay has bytes. Every `translate` reader is
  structural by rule, so the assertion cannot turn a malformed frame into a throw — and re-validating
  here would make replay disagree with the live path about which frames exist.
- **The clock is a counter, and the same one is handed to both sides of a round trip.** Message ids are
  minted by the injected clock, so identical event streams are only meaningful when both sides mint
  from the same sequence — which is exactly the property the round-trip test is asserting.
- **Fixtures are readable JSON, not recorded JSONL.** They are hand-written and reviewed, so they are
  stored as `[{ direction, frame }]` and converted to `FrameRecord`s on load. Everything downstream —
  classification, validation, replay — then treats a fixture and a capture identically.

## Tests

`conformance.test.ts` is the gate:

- every committed frame validates against the SDK's schema, and every response frame correlates to the
  request it answers (an uncorrelated response would silently fall back to the near-vacuous union check).
  A failure reports the error **count** and only the first few messages: `allErrors` on a oneOf yields
  dozens per bad frame — one per branch the payload failed — and a joined list that long is truncated by
  the test runner, hiding the leading message, which is the specific one (`SessionNotification
  /update/content/text: must be string`) because the method's own definition is what rejects it;
- the validator is shown to reject — a `session/update` missing its `update`, an invented stop reason,
  an undeclared method;
- the corpus covers **exactly** the variant set the schema declares for the six vocabularies a frame
  can carry — `SessionUpdate.sessionUpdate`, `ToolKind`, `ToolCallStatus`, `ContentBlock.type`,
  `ToolCallContent.type` and `StopReason`, named through `PROTOCOL_VOCABULARIES`. Set equality, not
  containment: a protocol variant added upstream fails this, and so does a corpus entry the protocol
  does not declare. One test per vocabulary, so a failure names which one drifted;
- every fixture replays into a **well-formed** event stream — block indices dense from zero, a chunk
  only ever continuing a block of its own kind, no write to an unstarted or ended message, no
  `tool_call_update` for a call never announced, and every turn settled;
- record → replay: each turn-bearing fixture is scripted into a fake agent process, driven through a
  real `connectAgent` with the recorder installed, and the recording replayed. The two event streams
  must be identical.

`translate/exhaustiveness.test.ts` consumes `PROTOCOL_VOCABULARIES` and `vocabularyVariants` from here,
which is the one edge back into this module and the reason `translate → testing` is listed as
test-only in the parent spec.

## Later

The corpus is synthetic. `fixtures/README.md` documents the one-command capture of a real agent, and
what a captured corpus would prove that this one cannot.
