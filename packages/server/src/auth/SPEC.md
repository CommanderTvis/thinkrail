---
id: submodule-server-auth
type: submodule-design
status: draft
title: auth — agent credentials + JetBrains Central
parent: module-server
depends-on: [module-contracts, module-shared]
references: [submodule-server-agent, module-acp, module-pi-agent, central-integration]
covers: [agent-owned-credentials, jetbrains-central]
tags: [v1, acp, auth]
---

## Responsibility

Everything a user does to make an **agent** able to reach a model: run one of the agent's auth methods,
sign out of it, list and re-point its providers — and, alongside those, the one credential surface that
is genuinely the **host's**, the native JetBrains Central CLI.

[[architecture]] Decision #13 moved provider credentials out of this process entirely. There is no
`ModelRuntime` here any more, no `auth.json`, no credential store, no login stream. The agent owns its
credentials and ACP names the operations: `authenticate`, `logout`, `providers/list`, `providers/set`,
`providers/disable`. This module is the **policy and composition layer** over those six operations —
it decides what degrades, what is refused, and what a report is composed from — plus the Central
lifecycle, which no agent can own because Central runs on the host.

## Boundary

- **Owns:**
  - `agentAuth` — the six `agent.*` credential wire methods, over an injected `AgentCredentials` port:
    - `agentAuthMethods(agentId)` → the agent's advertised methods, or `[]`.
    - `authenticateAgent({ agentId, methodId, env })` → `AgentAuthResult`. `env` carries the values an
      `envVar` method asked for and travels **client→host→agent only**; nothing here ever returns it,
      logs it, or puts it in an error.
    - `logoutAgent(agentId, methodId?)`.
    - `agentProviders(agentId)` → `AgentProvidersReport`: the agent's provider rows composed with the
      host's Central status and per-OS install command, plus `anyConfigured` — the folded "can this
      agent run" verdict (`isJbcentralUsable`, `providers.some(configured)`). That fold happens here,
      not in a client: a generic caller like the Welcome banner needs one boolean, not the two
      mechanisms' internals, so pushing the OR onto every consumer would mean re-deriving the same
      answer per surface (and getting it wrong the way the banner first did, by checking `providers`
      alone).
    - `setAgentProvider(agentId, routing)` — the only path a credential-bearing `headers` map takes,
      and it is write-only.
    - `disableAgentProvider(agentId, providerId)`.
    - `setAgentCredentials(resolver)` — the port-injection seam (defaults to unbound).
  - `jbcentral` — the in-app **JetBrains AI** flow over `shared/jbcentral`'s host-local adapter and
    artifact watcher: status, Connect, Disconnect, Start proxy, Update, Login, and the two publisher
    seams (`setJbcentralAppliedPublisher` for the successful-action analytics observation,
    `setJbcentralChangedPublisher` for the data-free `agent.changed` invalidation). The cross-module
    bounded-exit obligation and the drain's known starvation risk are owned by [[central-integration]]
    (Invariants).
- **Public surface (barrel):** `agentAuthMethods`, `authenticateAgent`, `logoutAgent`,
  `agentProviders`, `setAgentProvider`, `disableAgentProvider`, `setAgentCredentials`, and the port
  types `AgentCredentials` / `AgentCredentialsResolver` / `ProviderRouting`; `getJbcentralStatus`,
  `connectJbcentral`, `disconnectJbcentral`, `startProxyJbcentral`, `updateJbcentral`,
  `jbcentralLogin`, `startJbcentralWatch`, `stopJbcentralWatch`, the two publisher seams, and
  `resetJbcentralStateForTests` (the explicit lifecycle seam sibling host tests use).
- **Allowed deps:** `@thinkrail/contracts` (wire types), `@thinkrail/shared/jbcentral`, Node/Bun.
- **Forbidden:** **any sibling module** — including `agent`, whose connections this module reaches only
  through the injected port; `host`; **any pi package**; **any ACP type or the ACP SDK**; ever putting
  a credential **value** on the wire or in a log.

## Why a port rather than an `agent` edge

The old module reached into `agent` for a pi `ModelRuntime`. Under ACP the thing it needs is one live
`AgentConnection`'s credential half, and `agent` is the module that owns connections — so an
`auth → agent` edge would work. It is deliberately not taken:

- The six operations are the *only* thing this module wants from a connection, and naming exactly those
  six keeps `agent`'s much larger surface out of reach by construction rather than by convention.
- It makes the whole module testable with no process, no agent and no `~/.thinkrail`, which is what the
  suite here relies on.
- It leaves this module a leaf in [[module-server]]'s dependency graph. `host` is already the single
  composition root that installs every other cross-module seam (`setAgentPublishers`,
  `setMcpToolServer`, `setTerminalPublisher`); this is one more of the same.

`host` binds the resolver at `createServer`. The resolver's job is to resolve an agent id, ensure its
connection, and adapt it: it is where `AgentAuthResult`'s `terminal` outcome is produced (open the
agent's own login TUI as a real workspace terminal and answer its id) and where an `envVar` method's
values are applied to the agent's launch. Neither belongs here — this module owns no terminals and no
launch specs.

## Get right

- **Reads degrade, writes throw.** An unreachable agent advertises **no** auth methods and **no**
  providers rather than failing the read — that is [[architecture]] Decision #16's "what an agent
  cannot do is absent" applied to a read the Welcome strip makes before any chat exists. A write
  (`logout`, `setProvider`, `disableProvider`) rejects, because a user pressed a button and silence
  would be a lie. `authenticate` is the one write that answers `{ outcome: "failed", error }` instead
  of throwing: the failure is the result the sign-in card renders.
- **`agentProviders` keeps its Central half when the agent is down.** The two halves have different
  owners; a dead agent must not hide the JetBrains card or its install command.
- **A `required` provider is refused here**, against the agent's own list, before `providers/disable`
  is called — the contract says the method is rejected for such a provider, and the agent's list is
  the only thing that knows which.
- **`env` is never echoed.** Not in the result, not in an error message, not in a log line.

## JetBrains Central under ACP

Central is a host-local CLI that writes **one opaque pi extension artifact** at
`~/.pi/agent/extensions/jetbrains-central.ts`. That artifact is now consumed by
[[module-pi-agent]] in its own process; the host no longer loads it, so every runtime-generation
mechanism this module used to carry is gone — `preparePiRuntimeGeneration`, `activatePiRuntimeGeneration`,
the candidate/rebuild drain, the monotonic request sequence, and the `load-failed` / `candidate-failed`
statuses they produced. `JbcentralStatus` keeps those two states because the wire is shared with a
client that may talk to an older host; this host never emits them.

What survives is the part that was always host knowledge:

- **Status** combines `shared/jbcentral`'s executable/version/artifact postconditions with a cached
  auth/proxy observation. The observation is **refreshed off the read path and never polled**: a
  settled `supported` reading serves the cache immediately and, past `JBCENTRAL_STATUS_TTL_MS`, starts
  one background `central status` probe; a changed verdict publishes the ordinary invalidation, so an
  open card converges without any client timer. Only positively observed negatives set wire flags —
  `signed-out` sets `signedOut`, a stopped proxy sets `proxyStopped` on configured status, and
  `unknown` never sets either. A refused `central add pi`, a launched `central login` and a Start proxy
  attempt each drop the cache because each can make the observation stale. An out-of-band change
  inside the TTL window is deliberately served stale until the next read past it. The probe never runs
  while an action is in flight, so it cannot delay a Connect.
- **Actions** are process-wide single-flighted and serialized on one tail. Connect runs the
  minimum-version preflight then `central add pi`, whose artifact postcondition the adapter validates.
  Disconnect runs `central remove pi` and validates absence — an already-absent artifact is the
  complete postcondition and succeeds without invoking Central at all, so Disconnect still works when
  Central itself has been uninstalled. Update invokes `central update --install`, re-inspects, and
  re-adds only when an artifact was there before. Start proxy invokes
  `central proxy start --ensure-updated`, drops the cached observation, and validates that a fresh
  probe no longer positively reports stopped. Login launches `central login` and is reported successful
  only once the child has survived its grace period, so a login that cannot start surfaces as a failure
  rather than as an invitation to finish in a browser that never opened.
- **The watcher** debounces artifact events into one `agent.changed` invalidation. It no longer
  rebuilds anything — the pi agent reads the artifact when it starts.
- Status and action results use only the closed contracts taxonomy — never child output, artifact
  contents, diagnostics, proxy data, or an arbitrary thrown message.

**A running pi agent does not pick up a Connect.** One agent process is shared by every chat on it and
it read the artifact at spawn, so a Connect or Disconnect reaches the *next* process. That is the same
rule the in-process version had (a live session kept the runtime it was created with), now enforced by
the process boundary rather than by generation bookkeeping.

## Tests

`agentAuth.test.ts` drives the six operations against a fake `AgentCredentials`: an unreachable agent
advertising nothing, the providers report keeping its Central half without an agent, `env` forwarded
but never echoed, a thrown `authenticate` becoming `{ outcome: "failed" }`, the `terminal` outcome
passing through, and a `required` provider refused. `jbcentral.test.ts` drives the real adapter against
a fake `central` executable on `PATH` with a throwaway `HOME`: Connect/Disconnect/Update/Start proxy
postconditions, single-flighting, the out-of-band artifact change publishing an invalidation, the
off-read-path probe and its collapse/invalidation/staleness rules, and that no child output ever
reaches a result.

## Consumed by

`host` — it wires the six `agent.*` credential handlers plus the five `agent.jbcentral*` ones, binds
the `AgentCredentials` resolver, publishes `agent.changed` off `setJbcentralChangedPublisher`, tracks
the Central action off `setJbcentralAppliedPublisher`, and calls `stopJbcentralWatch()` on shutdown.
Nothing else imports this module.
