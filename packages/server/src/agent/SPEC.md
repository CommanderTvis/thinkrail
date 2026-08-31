---
id: submodule-server-agent
type: submodule-design
status: draft
title: agent — the host's ACP session manager
parent: module-server
depends-on:
  [
    module-acp,
    module-contracts,
    submodule-server-transcript,
    submodule-server-fs,
    submodule-server-terminal,
    submodule-server-persistence,
  ]
references: [architecture, module-pi-agent, submodule-server-host, submodule-server-auth]
covers:
  [
    acp-engine-boundary,
    agent-resolution,
    process-supervision,
    client-side-delegation,
    host-steering-queue,
    thinkrail-as-mcp-server,
    agent-capability-record,
    agent-owned-credentials,
  ]
tags: [v1, acp]
---

## Responsibility

The host's side of every chat. It decides **which agent** a chat runs on, keeps that agent's **process**
alive and reports when it is not, implements every **client-side method** the agent calls back into, and
runs the **session lifecycle** — create, prompt, steer, follow up, abort, list, read, delete — over the
transcript store.

It knows nothing about pi, and nothing about ACP either. `@thinkrail/acp` owns the protocol; this module
owns policy: worktrees, permissions, the transcript, the queue, which tools an agent is offered. The two
meet at one interface, `AcpClientDelegates`, which this module implements and hands to `connectAgent`.

## The shape

```
AgentSessionManager
 ├─ AgentSupervisor      one AgentConnection per agent id, many sessions on it
 ├─ AcpClientDelegates   fs · terminals · permission · elicitation · publish · MCP
 ├─ StagingClock         mints the ids the assembler and the transcript share
 └─ sessions: Map<SessionId, LiveSession>   queue · in-flight count · config · commands · plan
```

One process per **agent**, not per chat: ACP sessions are multiplexed on one connection, which is why
`packages/pi-agent` refusing `pi-acp`'s `closeAllExcept` mattered ([[architecture]] Decision #14).
A `LiveSession` holds only what the transcript cannot: whether a turn is in flight, what is queued, and
the push-only surfaces (config options, commands, plan) that no durable event carries.

## Boundary

- **Owns:** agent resolution and the installed catalog view; the supervised agent processes and their
  `AgentStatus` transitions; the `AcpClientDelegates` implementation; the host-side steering queue; the
  session registry and its lifecycle over `TranscriptStore`; the MCP offer put on `session/new`.
- **Public surface (barrel):** `getAgentSessions()` — the lazy process-wide manager, bound to the real
  siblings — plus `AgentSessionManager` / `AgentSessionManagerOptions` for tests and the workflow
  harness; `listInstalledAgents()` for the `agent.list` handler; the four seams `host` installs
  (`setAgentPublishers`, `setMcpToolServer`, `setBundledAgentLaunch`, `disposeAgentSessions`) and
  `agentsDir()`, the directory an install unpacks into; the two errors a handler must tell apart
  (`UnknownAgentError`, `AgentSessionLostError`); `BUNDLED_AGENT_ID`; `RestartPolicy` +
  `DEFAULT_RESTART_POLICY` and `createStagingClock` + `StagingClock`, both reachable through
  `AgentSessionManagerOptions`; `AgentAuthOutcome`, the credential-authenticate result `host` composes
  a terminal from; and the port interfaces (`WorkspaceLookup`, `WorktreeFiles`, `AgentTerminals`,
  `AgentDirectory`, `McpToolServer`, `AgentPublishers`, `SendMode`).
  The resolution functions, the supervisor, the delegate factory and `mcpOffer` are **not** exported:
  they are this module's own wiring, and the suites here reach them by file.
- **Allowed deps:** `@thinkrail/acp`, `@thinkrail/contracts`, and the siblings `transcript`, `fs`,
  `terminal`, `persistence`. Node `path` only.
- **Forbidden:** `host` (it installs publishers into this module, never the reverse); `auth`, `assist`,
  `reviews`, `history` or any other sibling; **any ACP type** — `@thinkrail/acp`'s barrel is ACP-free by
  construction and `translate/` is deliberately not re-exported; **any pi package**; the ACP SDK itself,
  which `scripts/check-architecture.ts` refuses to this package in source *and* in tests.

Everything this module reaches outside those four siblings comes through an injected port, which is what
lets the whole suite run with no process, no PTY and no `~/.thinkrail`. `hostPorts.ts` is the one file
that binds the ports to the real siblings; nothing else here imports them.

## Agent resolution

`Project.agentId` → `AppConfig.defaultAgentId` → the bundled pi agent ([[architecture]] Decision #15).
An id is **opaque** and is resolved against the installed catalog (`@thinkrail/acp`'s `registry`) at the
moment it is used.

**A configured id that is no longer installed is an error, not a fallback.** Silently re-pointing a
project at a different agent would move every future chat in it to a different model, different tools and
a different bill without saying so; `UnknownAgentError` names the missing id so the UI can offer to
install it or pick another. The bundled agent is the only implicit answer, and only when nothing was
configured.

`listAgents` puts the bundled agent first and drops any catalog row that claims its id, so a stale
`agents.json` entry can never shadow the agent that ships in the binary.

**The bundled launch spec is a seam, not knowledge.** How to re-invoke ThinkRail as its own agent is the
launcher's business: the default is `process.execPath acp-pi`, which is right for the compiled binary,
and `apps/cli` overrides it with `setBundledAgentLaunch` for a dev checkout. This module never spells
`thinkrail-acp-pi` or a path into `packages/pi-agent`.

## Process supervision

One `AgentConnection` per agent id, spawned on first use and shared by every chat that resolves to it.
Transitions are published as `agent_status` `ChatEvent`s to **every session on that agent**:
`spawning` → `ready`, then `crashed{willRestart}` → `restarting{attempt}` → `spawning` → `ready`, or
`unavailable{error}` when a connect fails.

- **A crash is one process, not the host.** This is [[architecture]] Decision #13 in code: the exit
  arrives as an `AgentExit` with the stderr tail, the in-flight turn settles `failed` through
  `packages/acp`, and the host keeps serving. Nothing here rethrows an agent fault into the host's own
  failure paths.
- **Restart is bounded and only for chats that exist.** `willRestart` is true only when a session is
  still open on that agent and the attempt budget is not spent; an agent nobody is chatting to is simply
  reaped. Backoff is exponential and capped. A crash loop therefore ends in `crashed{willRestart:false}`
  rather than spinning forever.
- **An explicit user action resets the budget.** `ensure()` on a spent agent clears `restarts` and tries
  again, because "the user asked for a new chat" is a better signal than any timer for when a crash loop
  has stopped being a loop.
- **A restarted agent does not silently inherit its old sessions.** The `SessionId`s belonged to the dead
  process. On the next prompt a session re-attaches with `session/load` when the agent advertises
  `sessionLoad`, and fails with `AgentSessionLostError` when it does not — the honest answer, because the
  transcript still reads and the chat is still there, it just cannot be continued on that agent. The
  replay `session/load` may push is diverted and dropped: the transcript is already the history
  ([[submodule-server-transcript]]).
- **A session registering learns the agent's current status.** The first `spawning`/`ready` pair happens
  before any chat exists to hear it, so `#register` replays the standing status. Without it a chat
  created against an already-running agent would have no status at all until something went wrong.

## Agent credentials

`auth`'s `AgentCredentials` port ([[submodule-server-auth]]) needs exactly one live connection's
credential half; `agent` gives it six methods on `AgentSessionManager` — `authMethodsFor`,
`authenticate`, `logout`, `listProvidersFor`, `setProvider`, `disableProvider` — so `host` can adapt
them without either module reaching the other. Nothing here imports `auth` and nothing there imports
`agent` or `@thinkrail/acp`; `host` is the only thing that sees both sides.

- **Reads ensure the connection; they do not merely peek.** `authMethodsFor` and `listProvidersFor`
  call the same `#ensureCredentialConnection` a write uses — spinning the agent up on first need —
  because the sign-in card has to work before any chat, and therefore any session-driven connect, has
  ever happened. A failure to ensure **propagates** rather than degrading here; degrading to an empty
  list on an unreachable agent is `auth`'s `readOr`, one layer up, matching the existing
  "an unreachable agent advertises no auth methods" contract.
- **`authenticate` dispatches on the method's own `kind`**, read off the connection's frozen
  `authMethods` (falling back to a direct agent-kind call for an id the connection does not recognise —
  ACP itself does not interpret `methodId`, only ThinkRail does, for UX). `kind: "agent"` calls
  `connection.authenticate(methodId)` and returns `{ kind: "handled" }`. `kind: "envVar"` respawns —
  see below — then authenticates on the fresh connection, because the ACP `authenticate` request
  carries no env parameter at all; the values reach the agent only through its launch env. `kind:
  "terminal"` never calls ACP `authenticate` at all: the method's own `terminalArgs` /
  `terminalEnv` (carried on `AgentAuthMethod` for exactly this) are merged onto the agent's normal
  launch spec and returned as `AgentAuthOutcome`'s `terminal` case, because composing a real terminal or
  choosing which workspace to open it in is `host`'s job, not this module's — it owns no terminals and
  no workspace registry beyond the one-lookup `WorkspaceLookup` port.
- **`AgentSupervisor.restartWithEnv(resolved, env)` is the smallest safe one-agent restart.** It marks
  the agent's existing entry `closing` (the same guard `closeAll()` uses) before closing or awaiting its
  connection, so the deliberate close is never mistaken for a crash and never trips the automatic
  restart/backoff machinery; it then drops the entry and reconnects through the ordinary `ensure()` path
  with `env` merged onto `resolved.launch.env`. No other agent's entry is touched. `authenticate` also
  marks every `LiveSession` on that agent `attached: false` right after, mirroring what a real crash
  status does, so the next turn re-attaches through `session/load` instead of assuming the fresh process
  remembers a session the old one never told it about.

## What the host does for the agent (`AcpClientDelegates`)

- **`fs/read_text_file` · `fs/write_text_file`** → `fs`, scoped to the *session's* worktree. Paths arrive
  absolute; the same containment guard reads use refuses one that escapes. `line`/`limit` are applied
  here rather than in `fs`, which owns whole files and path safety, not windows.
- **`terminal/*`** → `terminal`'s agent-owned group, in the session's worktree unless the agent names a
  cwd — which is itself resolved through the worktree guard, so a relative `../..` is refused rather than
  run. The command becomes a real ThinkRail tab the user can attach to and watch
  ([[submodule-server-terminal]]).
- **`session/request_permission` · `elicitation/create`** → the `agent.permission` / `agent.elicitation`
  wire channels, answered by `session.answerPermission` / `agent.answerElicitation`. Both are one
  `PendingAnswers` keyed by the request id `packages/acp` minted, and both resolve **cancelled** if
  nothing answers before the manager is disposed, so a dying host can never leave an agent blocked on a
  question. `elicitation/complete` (URL elicitations only, per the schema) cancels the pending request
  and pushes `{ type: "cancel" }` so the card disappears — the agent said it is finished, so what the
  user did or did not type no longer matters.
- **`publish`** → **the transcript first, then the wire**, one event at a time. A client that reconnects
  reads `session.getMessages` from the store, so an event on the wire that the store never saw would be
  an event that vanishes on reload. Pinned by a test that asserts every `log:` entry is immediately
  followed by its `ws:` twin.
- **`mcp/connect`** → the host's own MCP server ([[architecture]] Decision #17), reached through the
  injected `McpToolServer`. This module decides *whether* to offer it and *how*, never what is in it.

**An event for a session that is not registered *yet* is buffered; one for a session that is no longer
registered is dropped.** `session/new` publishes the session's `config_options` before its own response
resolves — before the transcript is open — so those are held per session id (bounded) and drained in
order the moment the session registers, which keeps transcript-before-wire true even for the first frame
of a chat's life. A session id the manager has ever registered is remembered, so a late update for a
chat that was deleted or archived is discarded rather than accumulating in a buffer nobody will drain.
The buffer therefore only ever holds a chat mid-creation, or one this host never opened at all (an agent
that outlived a host restart).

## Steering: native where it exists, held where it does not

`ChatCapabilities.steering` says which one is in force, and the panel reads that record rather than
asking ([[architecture]] Decision #16).

- **`native`** — the agent advertises the ThinkRail `steering` extension. A steer sent mid-turn goes out
  immediately as a second `session/prompt` carrying `_meta.steer.mode`.
- **`queued`** — everything else, which is every third-party agent today including Junie. The message is
  held and dispatched when the turn settles. One turn at a time, strict FIFO, no reordering between
  steer and follow-up: the user typed them in an order and the emulation does not get to improve on it.

Every path funnels through one queue and one pump, so a message sent to an idle chat and a message sent
mid-turn take the same code. `queue_changed` is published on every change, including back to `0/0`, so
the composer never has to infer that the queue drained. It carries both lane depths **and**, because the
host owns the queue rather than emulating one over an agent's, the queued texts — which is what lets the
pending strip render rows the user can edit and remove. A `native`-steering agent queues nothing here, so
that snapshot is absent and the depths come from the agent's own `_meta` signal; the strip then shows a
count and no rows. `SessionSummary.queue` carries the same snapshot for a live session when non-empty,
seeding a client that attached mid-run.

`clearQueue` drains both lanes and returns what it drained (the client's abort-restores path);
`removeQueued({ kind, index })` drops exactly one entry and returns it with the resulting snapshot.
Both are position-addressed because queue entries are bare texts on the wire; an out-of-range index is a
no-op returning `removed: null`. Neither needs the drain-and-re-queue emulation pi's all-or-nothing
`clearQueue()` forced, since the entries never left this process.

**Abort clears the queue.** Stop means stop; delivering the three messages a user queued behind a turn
they just cancelled would be a surprise, not a service.

## One id, minted here

`session.prompt` / `session.steer` / `session.followUp` answer with a `messageId` **immediately**,
including for a message that will not be sent for minutes. That id is the client's reconciliation key:
the optimistic bubble it renders is replaced in place when the authoritative `message_start` arrives
([[submodule-server-transcript]]'s replace-by-id rule). Holding the request open until dispatch would
blow the browser transport's request timeout; minting a second id at dispatch would grow a second bubble.

So the host mints it up front and **stages** it on the `AssemblerClock` it already injects into
`connectAgent` — the connection SPEC's "the clock is injected and its ids are the transcript's", used
for its intended purpose. `SessionAssembler.beginTurn` consumes exactly one `nextId()`, synchronously,
as the first thing `connection.prompt()` does, and the stage call sits immediately before that call with
no `await` between them. One staged slot, always consumed by the message it was staged for.

The clock therefore has two mouths: `nextId()`, which the assembler calls and which prefers the staged
slot, and `mint()`, which the host calls to make an id and which cannot see the slot at all. Without that
split, minting the *next* message's id would silently eat a stage.

**The hazard, stated plainly:** if an `await` is ever introduced between `stage()` and
`connection.prompt()`, or if `beginTurn` stops being the first id it mints, a staged id lands on the
wrong message and two chats swap echoes. `manager.test.ts` asserts the returned id is the id the echo
and the transcript carry, which is what catches it.

## Session lifecycle over the transcript

`SessionSummary` = `TranscriptStore.list()` composed with two process facts, `isStreaming` and `live`.
Nothing about a chat's *content* is recomputed here — the store already folded it.

- **create** — resolve workspace → project → agent; ensure the connection; `session/new` with the MCP
  offer; `store.open`; register. The `SessionId` the agent returns **is** the chat's id everywhere,
  including the UI tab.
- **read** — `store.read` for the messages, plus the live session's config options and plan, plus the
  capability record. A chat whose agent is not running gets the agent's last known record, and a chat
  whose agent has never run gets `dormantCapabilities`: every flag off. That is the capability rule
  applied to history — a chat you cannot continue offers nothing rather than controls that fail.
- **delete** — cancel, close it on the agent when `sessionClose` says the agent can, then `store.delete`
  (which is a move to the OS trash) and a `session.deleted` push. The agent-side close is best-effort:
  the recoverable half of the transaction is ours, and a chat must delete even when the agent is gone.
- **archive** (`releaseWorkspace`) — closes the live sessions and stops. The transcripts stay listed and
  searchable, per [[architecture]] Decision #16.

## Deleted, not ported

`sessionRepair`, `scanSessionFiles`, `readSessionFileIdentity`, `listSessionInfosStrict`,
`purgeDiskSessions`, `repairDanglingToolCalls`, the pi tombstone map, the cwd disambiguation and the
runtime generations are all gone. Every one of them existed because the *agent* owned the record and the
host had to reconcile with it. The transcript store's fold law — live and reloaded produce the same
object graph by construction — removes the class ([[submodule-server-transcript]]). `isDeleted` is the
one tombstone; `repairOnOpen` is the one repair; there is no second id space to disambiguate.

## Tests

`resolve.test.ts` pins the precedence chain, the point-of-use failure, and the bundled-agent-first list.
`clock.test.ts` pins the two mouths: a staged id goes to exactly one caller, `mint()` cannot see the
slot, and a second stage replaces the first rather than queueing behind it.
`mcp.test.ts` pins the offer for each `McpToolDelivery`, including the HTTP fallback Junie actually takes.
`delegates.test.ts` runs the real `fs` module against a temp worktree: an absolute read inside is served,
an escaping read *and* an escaping write are refused with the file untouched, a terminal defaults to the
session cwd and refuses an escaping one.
`manager.test.ts` drives the whole thing against `testAgent.ts` — a scripted agent behind
`@thinkrail/acp`'s injectable `ProcessSpawner`, so nothing spawns a process and nothing is timing luck.
It covers: create → transcript → summary; the staged id surviving to the echo and the log;
transcript-before-wire for every durable event; the queue holding a steer and dispatching it at turn end
versus native steering going out mid-turn; abort clearing both; a mid-turn crash reported as
`crashed{willRestart:false}` with the turn settled `failed` and the host alive; a crash inside the budget
walking `crashed → restarting → spawning → ready` with a second process; delete closing on the agent and
trashing the record; the `config_options` published before the transcript exists arriving in order; and
permission, elicitation-cancel, `fs/read_text_file` and `terminal/create` answered over the real
protocol path. It also covers the six credential methods: `authMethodsFor` translating what `initialize`
advertised and propagating a spawn failure rather than degrading it (that degrade is `auth`'s `readOr`,
pinned separately in its own suite); `authenticate` calling straight through for an agent-kind method and
surfacing the agent's own rejection unchanged; a full respawn for an envVar-kind method — a second
process spawned with the collected value merged onto its launch env, `authenticate` retried only on the
fresh connection; a terminal-kind method resolving to a launch descriptor with no RPC sent at all; and
`logout` / `setProvider` / `disableProvider` sending exactly the request the agent expects.

`testAgent.ts` is test-only and imports nothing but `@thinkrail/acp`'s process types. It deliberately
echoes the `protocolVersion` the host asks for rather than naming one, because this package may not
import the ACP SDK to read `PROTOCOL_VERSION` — and echoing is what a real agent negotiating v1 does. Its
`ScriptedAgentOptions.authMethods` seeds `initialize.authMethods` the same way `agentCapabilities` seeds
`agentCapabilities`, and `reject()` sits beside `reply()` for the one shape `reply` cannot make: a
JSON-RPC error a scripted agent sends back on purpose.

## Later

- **No `agent.install` / `agent.registry` handler here.** Resolution reads the catalog
  `@thinkrail/acp`'s `registry` writes; downloading and unpacking an install plan belongs with the host,
  where the data dir and a progress channel already live.
- **The agent's own copy of a deleted session is left alone.** ACP has `session/delete`, but
  `ChatCapabilityFlags` has no `sessionDelete` field to gate it on, and calling an unadvertised method to
  see what happens is not a design. Adding the flag is a `packages/acp` + `packages/contracts` change.
- **`queue_changed` is published for the host's queue as well as the agent's**, while
  `ChatCapabilities.queueDepth` still reports only the agent's `_meta` extension. The record should say
  `true` whenever steering is `queued` too, since the host then knows the depth exactly; that is a
  `packages/acp` negotiation change.
- **`SessionSummary.openTodos` is left unset.** It is the `todos` module's number, and `host` composes
  the two rather than adding an `agent → todos` edge.
