---
id: submodule-acp-connection
type: submodule-design
status: draft
title: connection — process, handshake, sessions
parent: module-acp
depends-on: [module-contracts]
covers: [acp-engine-boundary]
tags: [v1, acp]
---

## Responsibility

The agent subprocess and everything that depends on it living: stdio framing, the `initialize`
handshake, per-session assembly state, the `AgentConnection` facade the host drives, and shutdown.

## Boundary

- **Owns:** the child process, the stdout line filter and stderr tail, the `ClientApp`, the session
  registry (one `SessionAssembler` per session), and the composition of `client`, `capabilities` and
  `translate`.
- **Public surface (barrel):** `connectAgent`, `AgentConnection`, `AgentLaunchSpec`, `AgentExit`,
  `ConnectAgentOptions`, `NewSessionInput`, `LoadSessionInput`, `PromptInput`, `SessionHandle`,
  `McpServerOffer`, `ProcessSpawner`, `SpawnedProcess`, `spawnWithBun`, and the four error classes.
  `spawnWithBun` is exported only so a decorator can wrap the default: `connectAgent` still uses it
  when `spawn` is absent, and the frame recorder in `testing` layers on top of it rather than
  reimplementing `Bun.spawn`.
- **Allowed deps:** `@agentclientprotocol/sdk`, `@thinkrail/contracts` (types), siblings `client`,
  `capabilities`, `translate`, `meta`; `Bun.spawn` behind the `ProcessSpawner` seam.
- **Forbidden:** `registry` (the host resolves a launch spec and hands it in); the host; the filesystem.

## Pinned surface

```ts
export interface AgentLaunchSpec { command: string; args: string[]; env?: Record<string,string>; cwd?: string }
export interface AgentExit { code: number|null; signal: string|null; stderrTail: string; stdoutNoise: string }
export type ProcessSpawner = (launch: AgentLaunchSpec) => SpawnedProcess
export type McpServerOffer =
	| { kind: "acp"; name: string; serverId: string }
	| { kind: "http"; name: string; url: string; headers?: { name: string; value: string }[] }

export interface AgentConnection {
	readonly agent: AgentDescriptor
	readonly capabilities: ChatCapabilities
	readonly signal: AbortSignal
	readonly exited: Promise<AgentExit>
	readonly authMethods: AgentAuthMethod[]
	newSession(input: NewSessionInput): Promise<SessionHandle>
	loadSession(input: LoadSessionInput): Promise<SessionHandle>
	listSessions(cwd?: string): Promise<SessionRecord[]>
	deleteSession(sessionId: string): Promise<void>
	closeSession(sessionId: string): Promise<void>
	prompt(input: PromptInput): Promise<{ messageId: MessageId; settlement: TurnSettlement }>
	cancel(sessionId: string): Promise<void>
	setConfigOption(i: { sessionId: string; optionId: string; value: ConfigValue }): Promise<ConfigOption[]>
	authenticate(methodId: string, value?: string): Promise<void>
	logout(methodId?: string): Promise<void>
	listProviders(): Promise<AgentProviderInfo[]>
	setProvider(routing: { providerId: string; apiType: string; baseUrl: string; headers?: Record<string, string> }): Promise<void>
	disableProvider(providerId: string): Promise<void>
	ext<R>(method: string, params: Record<string, unknown>): Promise<R>
	close(): Promise<AgentExit>
}

export function connectAgent(options: ConnectAgentOptions): Promise<AgentConnection>
```

`ConnectAgentOptions` carries `agent: AgentDescriptor`, `launch`, `delegates`, and optional `profile`,
`clock: AssemblerClock`, `spawn`, `handshakeTimeoutMs`, `onCapabilities`, `onExit`.

What the shapes above do not say on their own:

- `launch.env` is **overlaid** on the host's environment, never a replacement — an agent still needs
  `PATH`, `HOME` and friends.
- `prompt` resolves with the turn's settlement, and that settlement is **published before** the promise
  resolves — a caller awaiting it never races the events that describe it.
- `SpawnedProcess.exited` resolves once the process is gone and **never rejects**; draining a
  diagnostic stream never rejects either, because a pipe that died with its process is not a failure
  and the bytes that did arrive are still the diagnostic.
- `McpServerOffer` has two kinds because there are two transports: `acp` rides the ACP connection
  itself and needs no port, `http` is the fallback for agents that cannot carry one.
- `PromptInput.steer` marks a prompt sent while a turn is already in flight, for agents that route one.
- `AgentConnection.capabilities` is widened by observation while the connection lives — read it, never
  cache it.
- `AgentConnection.authMethods` is captured **once**, from `InitializeResponse.authMethods`, through
  `capabilities`'s own `authMethods` function — the same read `negotiateCapabilities` uses to derive the
  `authentication` flag. It never changes for the life of the connection: ACP has no update for it, and
  it is `[]` rather than absent when the agent advertised none.
- `listProviders`, `setProvider` and `disableProvider` all gate on one flag,
  `capabilities.providerConfig`, fixed at negotiate time from `agentCapabilities.providers`. An agent
  that never advertised it answers a read with `[]` and a write with a thrown `Error` naming the agent —
  never a bare `providers/*` protocol rejection for a method the agent was never going to implement.
- `clock` defaults to the wall clock plus `crypto.randomUUID()` per message.
- `AcpConnectionClosedError.exit` is `null` only when the connection closed without one.

## Failure modes this module owns

- **Spawn failure.** `Bun.spawn` throws synchronously for a missing or non-executable binary.
  `AcpSpawnError` discriminates `not-found` / `not-executable` / `failed`, because "install the agent",
  "chmod it" and "here is the OS error" are three different things to tell a user. The throw travels as
  the OS reported it and `connectAgent` classifies it — for the default spawner and an injected one
  alike — so the reasons a user is shown come from one place.
- **Banner text on stdout** is diverted into a bounded ring surfaced as `AgentExit.stdoutNoise`, instead
  of letting the SDK `console.error` each line into the host log.
- **Crash mid-turn.** stdout ending closes the connection and rejects pending requests; the in-flight
  prompt settles as `failed` with the stderr tail in its message, so the transcript keeps a failed turn
  rather than a turn that never ended. The shutdown ladder still runs when the connection closes on its
  own, so a half-dead agent is reaped rather than orphaned and `exited` always settles.
- **A handshake that times out and a handshake the agent rejects are one failure.** Both mean "this
  thing is not usable", both reap the process, and both surface as `AcpConnectionClosedError` carrying
  the agent's own output.
- **A rejection the agent marks auth-required** — the SDK's `-32000`, or that wording when it sends no
  code — becomes `AcpAuthRequiredError`: the sign-in card, not a failure banner.
- **Protocol-version mismatch** kills the process rather than half-driving it.
- **Clean shutdown.** Close the connection, end stdin (EOF is how a well-behaved agent learns to exit),
  grace, SIGTERM, grace, SIGKILL. `close()` always resolves with an `AgentExit`.

## Decisions

- **The `session/update` handler stays synchronous** through assembly and publish: notifications and the
  `session/prompt` response share one stream, so awaiting mid-handler would let a turn settle before its
  own final chunks were published.
- **`prompt()` publishes the settlement before it resolves**, through the same sink as everything else,
  so the browser's push-driven reducer needs no request/response knowledge.
- **The clock is injected and its ids are the transcript's.** The host passes the generator; the
  assembler mints message ids with it. That is the whole of the "who owns message identity" answer.
- **The spawner is injectable**, which is what makes agent-crash, missing-binary and version-mismatch
  coverage deterministic and offline (Decision #14). The stdin sink is typed structurally
  (`ByteSink` over Bun's `FileSink`) for the same reason: a scripted process needs no Bun handle.
- **Stdout is filtered on the opening brace.** Every ACP v1 frame is a JSON object, so a line that does
  not start with `{` is noise and goes to the ring; re-parsing each line to prove it would double the
  cost of the hot path. A `[` line is deliberately *not* accepted — v1's stream carries individual
  messages, and a leading bracket is how half the logging libraries in existence start a line. Shipping
  adapters print a startup banner, so this is launch-time reality rather than a defensive nicety.
- **Diagnostics keep the tail, not the head** — the end of a stream explains a failure, the start rarely
  does. `EXIT_DRAIN_MS` bounds the wait for stderr to finish after the process is gone, because a forked
  grandchild can hold that pipe open past its parent and the tail is not worth a hang.
- **`publish` is the one sink.** Everything this connection produces passes through it, which is what
  makes the two things that ride alongside every batch — widening the record on what the agent actually
  did, and diverting a `session/load` replay away from the live view — happen in one place.
- **The capability record is `null` until the handshake lands.** An agent that pushes an update before
  answering `initialize` is ignored rather than allowed to crash the notification stream.
- **The connection's `AbortController` exists before the ACP connection**, because `client`'s MCP bridge
  takes its signal at handler registration, which happens first.
- **Session state is created on first sight of a session id.** An agent may push updates for a session
  this host never opened — it outlived a host restart — and a dropped update is a lost turn.
- **The per-session token accumulator lives here.** One turn's reported tokens fold into the session
  total the next usage frame carries, so the host keeps exactly one running total and never recomputes
  what it was told.
- **`session/list` reports four facts and no more.** Everything else a `SessionRecord` says — counts,
  usage, settlement, workspace — belongs to the host's transcript store, which reconciles these rows
  against its own by `sessionId`.
- **`authenticate` carries a method id and nothing else in ACP.** A method that needs one typed answer
  gets it as an extra field, which agents that do not read it drop.
- **Provider methods are gated the same way this connection is honest about everything else it cannot
  assume: one flag, read once, never probed per call.** `listProviders`, `setProvider` and
  `disableProvider` all read `capabilities.providerConfig`, so there is exactly one place that decides
  whether this agent does provider configuration, and a caller never learns the answer by trying the
  request and catching a protocol error.
- **Every timeout race swallows the loser's rejection**, which would otherwise surface unhandled after
  the winner has already been reported.

## Tests

`connect.test.ts` drives the lifecycle against a scripted agent over the `ProcessSpawner` seam — no
binary, no pipes, no timing luck. The fake behaves like a well-mannered process (stdin EOF exits, a
signal exits) so a test that never reaches the shutdown ladder does not pay for it, and its crash lands
the exit *before* stdout ends, as a real one does. Covered: the two spawn failures told apart, a banner
before the first message, a refused protocol version, a death mid-turn (settles `failed`, with the echo,
turn start and settlement all published before `prompt()` resolves), an idempotent `close()`, and
observation widening the record exactly once. Also covered: `authMethods` translated from `initialize`
and empty when the agent advertises none; `listProviders` answering `[]` with no request sent when
`providerConfig` is absent and translating a real `providers/list` reply when it is present; and
`setProvider`/`disableProvider` refusing before a request is sent when unsupported, then sending the
exact params the agent expects once advertised.
