---
id: submodule-acp-capabilities
type: submodule-design
status: draft
title: capabilities — the negotiated ChatCapabilities record
parent: module-acp
depends-on: [module-contracts]
covers: [agent-capability-record]
tags: [v1, acp]
---

## Responsibility

What this client advertises to an agent, and the single `ChatCapabilities` record every panel reads.

## Boundary

- **Owns:** `THINKRAIL_CLIENT_CAPABILITIES` / `THINKRAIL_CLIENT_INFO`; the fold of `initialize`'s
  `agentCapabilities` + the agent's advertised `_meta` extensions + a registry profile into
  `ChatCapabilities`; the observation-driven widening; the bundled agent profiles.
- **Public surface (barrel):** `THINKRAIL_CLIENT_CAPABILITIES`, `THINKRAIL_CLIENT_INFO`,
  `negotiateCapabilities`, `observeCapabilities`, `authMethods`, `AgentProfile`, `profileFor`,
  `BUNDLED_AGENT_PROFILES`, `NegotiateInput`, `CapabilityObservation`.
- **Allowed deps:** `@agentclientprotocol/sdk` (types), `@thinkrail/contracts` (types), sibling `meta`,
  `translate/guards`.
- **Forbidden:** every other sibling; any I/O.

## Decisions

- **We advertise `fs.readTextFile`, `fs.writeTextFile` and `terminal` unconditionally** (Decision #18):
  an agent's edits then pass through the host so unsaved editor buffers are visible to it, and its
  commands surface as watchable terminals in the right worktree instead of running out of sight. The
  same record's `_meta` advertises which ThinkRail extensions this client understands, so an agent
  that speaks them knows it may send them.
- **Negotiated at connect, widened by observation.** Plans, commands, usage and config options are
  push-only; nothing announces them. An unknown agent starts with each `false` and earns it on first
  arrival. `observeCapabilities` returns a record only when something changed, so the host broadcasts
  once, and stamps `derivedFrom: "observed"` so the "why is this missing?" affordance can say *how* it
  was learned. `CapabilityObservation` is ours and closed, and `connection` is the only thing that
  mints one, so the switch over it ends in `assertNever` — a new observation kind that no one taught
  this function to widen is a build failure, not a capability that silently stays `false`.
- **A registry profile is a hint for the agents we test (Decision #13), never a probe.** It seeds those
  same push-only flags so a known agent's controls are present on the first frame, not the second.
  Beyond those flags a profile records how ThinkRail's own tools reach the agent when the protocol
  leaves a choice (`mcpTools`, Decision #17 — `NegotiateInput.mcpTools` is the host's resolved answer
  and outranks both the profile and `mcpCapabilities`), whether the JetBrains Central setup card
  applies to its provider configuration, and whether its workflow skills route automatically rather
  than being user-invoked prompts. An agent with no profile is generic and negotiates from scratch.
- **Steering is `"native"` only when the agent advertises the `steering` extension**; everything else is
  `"queued"` and the host holds the message until the turn ends. The record states which, so the
  composer can be honest about it.
- **Elicitation and permission are `"host"`-sourced and always true.** They are *client* capabilities —
  any agent may ask once we advertise the dialog — not something an agent earns.
- **`derivedFrom` is populated for every flag at negotiate time.** A flag with no provenance is a bug in
  this module, not an unknown; the fake-agent tests assert the full key set.
- **`authMethods` is the sign-in card's rows**, read structurally off `initialize` — an agent that
  advertises none simply has no `authentication` flag. `connection` calls the same function once at
  connect, over the same field, to freeze `AgentConnection.authMethods` for the life of the connection —
  one reader, two callers, never a second translation of the same union.
- **A `terminal` method's `args`/`env` are carried onto `AgentAuthMethod` as `terminalArgs`/
  `terminalEnv`**, empty only when absent from the wire — they are what the host merges onto the
  agent's normal launch spec so the same binary runs its login flow instead of speaking ACP, which is
  otherwise unreachable: without them a terminal-kind sign-in would launch nothing but the agent's
  ordinary stdio process. Read only for `kind: "terminal"`; a non-terminal method never carries them
  even if the wire sends the fields anyway.

## Tests

`negotiate.test.ts` pins `authMethods` against every `AuthMethod` variant: agent (no `type`), `env_var`
with its variables and link, `terminal` (bare, and with `args`/`env` carried onto `terminalArgs`/
`terminalEnv`, empty ones carrying neither), an unrecognised `type` falling back to `agent` as the
schema requires, `args`/`env` ignored on a non-terminal method, and a malformed or non-array
`authMethods` field reporting none. It builds payloads as bytes off a wire rather than as SDK literals,
the same way `translate`'s own suites do, because `authMethods` reads them the identical structural way.
