---
id: module-acp
type: module-design
status: draft
title: ACP client — spawn, negotiate, translate
parent: architecture
depends-on: [module-contracts]
references: [module-server, module-pi-agent]
covers: [acp-engine-boundary, agent-capability-record, client-side-delegation, thinkrail-meta-namespace, agent-registry, agent-detection]
tags: [v1, acp]
---

## Responsibility

The ACP **client** half of ThinkRail: launch an agent process, frame JSON-RPC over its stdio, run the
`initialize` handshake, serve every client-side method the agent calls back into, and translate the
protocol into ThinkRail's own chat model. The only package **on the client side of the protocol** that
may import an ACP type ([[architecture]] Decision #19).

It owns no policy: it does not decide which agent to run, where a worktree is, what a terminal is, or
what the transcript should say. `packages/server` decides all of that and injects the answers.

## Boundary

- **Owns:** the agent subprocess and its stdio framing; the handshake and version check; the
  `ChatCapabilities` derivation; the ACP↔ThinkRail translation including per-session message assembly;
  the client-side handlers (`fs/*`, `terminal/*`, `session/request_permission`, `elicitation/*`,
  `mcp/*`); the ThinkRail `_meta` namespace and `_ext` table; the registry client, the installed
  catalog, and the curated detection pass behind `agent.detect`.
- **Public surface (`@thinkrail/acp`):** `connectAgent` + `AgentConnection` and its input/error types;
  `negotiateCapabilities`, `observeCapabilities`, `authMethods`, `THINKRAIL_CLIENT_CAPABILITIES`,
  `THINKRAIL_CLIENT_INFO`, `AgentProfile`, `profileFor`, `BUNDLED_AGENT_PROFILES`; `AcpClientDelegates`
  and the plain types it takes; the registry functions. Plus the **`@thinkrail/acp/meta` subpath**,
  which `packages/pi-agent` imports so both ends of the extension namespace are defined once, and the
  **`@thinkrail/acp/testing` subpath** — the frame recorder, the schema conformance validator and the
  committed frame corpus. `testing` is a *development* surface: it is what a capture, a conformance run
  or a fixture-driven test imports, and nothing on the production path may.
  **`translate/` is deliberately not re-exported** — its *inputs* are ACP shapes, so exporting it would
  hand an ACP type to `server`.
- **Allowed deps:** `@agentclientprotocol/sdk`; **`zod`** — a real runtime dependency, not an optional
  peer: the SDK's main entry statically `import`s `./schema/zod.gen.js`, so it also lands in the binary
  bundle and is in `check:seams` scope; `@thinkrail/contracts` (types-only); Bun/Node built-ins. Plus
  **`ajv`**, a devDependency reachable from `testing` alone — it compiles the SDK's own
  `schema/schema.json`, so it is a test tool rather than a runtime one and must never enter the bundle.
- **Forbidden:** `@thinkrail/server`, `@thinkrail/shared`, `apps/*`, any pi package, `bun-pty`, any
  filesystem or git knowledge beyond the injected agents directory. No ACP type in the public surface.

## Sub-modules and dependency graph

`connection` (process, framing, handshake, session lifetime) · `capabilities` (the negotiated record) ·
`translate` (ACP↔ThinkRail, pure) · `client` (the methods the agent calls back into) · `registry` (the
published registry, the installed catalog and shortlist detection) · `meta` (the `_meta` namespace) ·
`testing` (schema conformance, frame recording, deterministic replay, the fixture corpus).

`connection` is the composition root — the only module that builds a `ClientApp`, owns a process, or
holds mutable per-session state.

- `connection` → `client`, `capabilities`, `translate`, `meta`
- `client` → `translate`
- `capabilities` → `meta`, `translate/guards`
- `translate` → `meta`; and, **in tests only**, `testing` — the one edge here a source file may
  not take, which is what keeps the source graph acyclic while `testing` reaches back into
  `translate`
- `registry` → `connection` (**types only**: `AgentLaunchSpec`), `capabilities` (**types only**:
  `AgentProfile`)
- `testing` → `connection` (the `SpawnedProcess` seam and the default spawner it decorates),
  `translate` (the assembler replay drives, and the structural readers a frame is parsed with).
  Nothing imports `testing` back except a test.
- `meta` → leaf, deliberately dependency-free — not even `contracts`

Acyclic. `client` never imports `connection`: it declares the `AcpClientRuntime` interface it needs and
`connection` implements it. `registry` is never imported by `connection` — the host resolves a launch
spec and hands it in.

## The five structural mismatches, and where each is solved

1. **Message container vs chunk stream.** `translate/assembler.ts` rebuilds ThinkRail's ordered block
   array from arrival order: one open message per session, a new block when the chunk *kind* changes or
   a tool call interrupts, and `tool_call` (which carries no `messageId`) attached to the open assistant
   message. It assigns the block indices the wire and the log both address by.
2. **Cumulative snapshot vs deltas.** The assembler emits the wire's three write modes rather than
   re-synthesising whole-message snapshots, which would ship every token of a long message on every
   delta — over Tailscale to a phone.
3. **`stopReason` moves from message to turn.** `settlement.ts` maps a `PromptResponse` to a
   `TurnSettlement` and a rejected prompt to `{ stopReason: "failed", error }`. The old `dead`
   tool-call flag becomes **real state**: `settle()` emits `tool_call_update { status: "abandoned" }`
   for every call still running, so no card can spin past a settlement and no renderer reaches across
   messages.
4. **Tool identity.** `toolCall.ts` makes `toolName` required: the agent's `name`, else `acp:<kind>` —
   a key **no built-in renderer claims**, because mapping an unknown `execute` tool onto the bash card
   would make it read `arguments.command` out of a `rawInput` with no such field.
5. **Transcript retrieval.** This package never serves history. `session/load`'s replay goes to an
   optional per-call sink and is otherwise dropped. Message ids are minted by the injected clock, so the
   ids the assembler mints **are** the ids the transcript stores — one authority, no mapping table.

## Decisions

- **`translate/` reads ACP payloads through structural guards, not SDK type narrowing.** Signatures take
  SDK types so the boundary is checked; bodies read through `guards.ts`. These are bytes from another
  process on the hot notification path where an exception costs the rest of a turn, and much of the
  surface is UNSTABLE upstream — a shape that shifts must degrade rather than fail to compile.
- **The subprocess seam is injectable.** `connectAgent` takes an optional `spawn`; the default uses
  `Bun.spawn`. That is what lets the scripted fake agent (Decision #14) and every translate test run
  with no process at all.
- **Banner text is filtered, not tolerated.** The SDK's `ndJsonStream` survives a non-JSON line but
  `console.error`s each one, flooding the host log with exactly the output a user needs when a launch
  goes wrong. `stdioFraming` diverts them into a bounded ring surfaced as `AgentExit.stdoutNoise`.
- **Protocol version is exact.** Only the SDK's `PROTOCOL_VERSION` is accepted; anything else fails
  `AcpVersionError` and the process is killed. A half-understood protocol is worse than a clear refusal.
- **`user_message_chunk` during a turn we started re-announces the echo's id**, which the wire's replace
  rule turns into an in-place upgrade — pi's `/skill:x` → expanded `<skill …>` behaviour, expressed once
  and without a `message_replace` event.
- **Capabilities are negotiated at connect and *widened* by observation.** Plans, commands, usage and
  config options are push-only in ACP — no field announces them — so a record frozen at connect could
  only ever say `false` for an unknown agent. `observeCapabilities` widens on first arrival, stamps
  `derivedFrom: "observed"`, and returns `undefined` when nothing changed so the host broadcasts once.
  Panels still only read the record (Decision #16); they never probe.
- **The fail-closed allowlist survives the protocol change.** A model reaches the UI as
  `{ id, name, description? }` and nothing else, so a future `SessionConfigSelectOption` field — or an
  agent stuffing a credential-bearing URL into an option's `_meta` — is excluded by default.
- **`RequestError` is read structurally, never by `instanceof`.** Bundling can produce two class
  identities for it, and both sides of the connection pay for that: `connection` duck-types an agent's
  rejection on `code`/`message` so an unmatched error cannot lose the agent's own text, and `client`
  re-wraps a host throw the same way so an unmatched one cannot lose the code the thrower chose.
- **Cost carries its currency.** Nothing here assumes USD or normalises between currencies.
- **The registry resolves and records; it does not download.** Producing an `InstallPlan` keeps tar/zip
  and network *writes* in the host, where a progress UI and a data directory already live.
- **Provider and auth-method translation stays where each one already lived, rather than gaining a
  second home.** ACP `AuthMethod[]` → `AgentAuthMethod[]` is `capabilities`'s `authMethods` function,
  because it already reads `initialize.authMethods` structurally to derive the `authentication` flag;
  `connection` now calls that same function once at connect to freeze `AgentConnection.authMethods` for
  the connection's life, rather than translating the union a second time. `translate/providers.ts` adds
  the mapping neither module had a reason to own yet: ACP `ProviderInfo` → `AgentProviderInfo`
  (`configured` is `current`'s presence, not its truthiness) and the round trip from a plain
  `{providerId, apiType, baseUrl, headers?}` to `SetProviderRequest`. `listProviders`, `setProvider` and
  `disableProvider` all gate on `ChatCapabilities.providerConfig` — the flag the record already derives
  from `agentCapabilities.providers` — so an agent that never advertised the capability gets an empty
  list from a read and a clear thrown `Error` from a write, never a bare protocol rejection.

## Invariants

- No ACP type in an exported signature; `translate/` is not re-exported.
- Nothing in `translate/` touches a process, clock, random source or filesystem — ids and timestamps
  come from an injected `AssemblerClock`, so every translation is deterministic.
- `AcpClientDelegates` is the only way this package reaches the outside world.
- A malformed `_meta`, an unknown `ToolKind`, an update for an unseen id, or a non-object `rawInput`
  must degrade — never throw into the notification stream.
- Every dispatch on a protocol vocabulary is exhaustive at compile time. A union ACP declares closed is
  narrowed through a table typed as a mapped type over the SDK's union and ends in a `never` branch, so
  an SDK bump that adds a variant fails to build instead of falling into a permissive default. The two
  unions ACP declares open keep a runtime fallback by design and are pinned only by
  `translate/exhaustiveness.test.ts`.
- The `session/update` handler stays synchronous through assembly and publish: notifications and the
  `session/prompt` response share one stream, so awaiting mid-handler would let a turn settle before its
  own final chunks were published.

## Tests

`src/boundary.test.ts` reads every source file here and asserts the import statements against the
dependency graph above. Five of these decay silently and none of them fails to compile: an ACP type
escaping past the sub-modules that face the protocol, `meta` growing a dependency `packages/pi-agent`
would then inherit, `client` reaching back into `connection` and closing the graph into a cycle,
`translate` picking up a clock or a filesystem, and `ajv` — a devDependency — reaching a sub-module
that ships. It also holds the barrel rule — a sibling is crossed
through its `index.ts`, with `capabilities → translate/guards` as the one sanctioned exception, which
is sanctioned because `capabilities` reads ACP payloads through the same structural guards `translate`
does and duplicating them would be worse than the reach — and pins the manifest to the allowed deps
above. `registry` is the only sub-module allowed a node builtin, and a test may read the disk it
guards. The sub-module list is derived from the directory tree, so a new sub-module is guarded the
moment it exists. **When a spec's dependency graph changes, that table changes with it.**

`connect.test.ts` covers the process lifecycle against a fake spawner; `translate/`'s suites cover the
mappings, and `translate/exhaustiveness.test.ts` compares each translator's handled variant set against
the published JSON schema — the one check that catches a protocol vocabulary growing a member, which no
amount of type checking can see for the unions ACP declares open. It reads the schema through
`testing`'s `PROTOCOL_VOCABULARIES` rather than naming `$def`s of its own, which is why
`translate → testing` is the graph's one test-only edge; that table is also what the corpus-coverage
half of `conformance.test.ts` asks, so the two suites can never disagree about where a vocabulary
lives. `testing/conformance.test.ts` validates the committed frame corpus against the SDK's schema,
asserts the corpus covers every variant that schema declares, and pins record → replay against the
live connection's own events. See each sub-module's `SPEC.md`.

## Later

ACP v2 removes client-side `fs` and `terminal` (Decision #18). When it lands, `client/` loses two
handler groups and `capabilities/` stops advertising them; nothing else in the repo moves. That
containment is the whole point of this module.
