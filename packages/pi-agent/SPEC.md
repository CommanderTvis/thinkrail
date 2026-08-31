---
id: module-pi-agent
type: module-design
status: draft
title: pi-agent — ThinkRail's first-party ACP agent
parent: architecture
depends-on: [module-contracts, submodule-acp-meta]
references: [module-acp, module-server, module-spec-graph, module-todos, module-visualize, module-thinkrail-workflow]
covers: [first-party-pi-agent, acp-engine-boundary, client-side-delegation, thinkrail-meta-namespace]
tags: [v1, acp, pi]
---

## Responsibility

ThinkRail's pi support, shipped as an ACP **agent** rather than consumed as a third-party adapter
([[architecture]] Decision #14). It wraps `@earendil-works/pi-coding-agent`, speaks the agent side of
JSON-RPC over stdio, and is launched by the host as a subcommand of the ThinkRail binary.

**This is the only package in the repo permitted to import pi** — value or type, any subpath — and the
only one that implements the *agent* side of ACP.

## Boundary

- **Owns:** the pi runtime generation, pi session lifetime, pi resource/skill loading, the
  `ask_user_question` tool, and the restart repair (`engine`); the ACP handler table, the capability
  record, the event→notification translation and the delegated file/shell tools (`acp`); the stdio
  framing and process lifetime of the agent (`stdio.ts` / `main.ts`).
- **Public surface (`@thinkrail/pi-agent`):** `createPiAgentApp`, `runPiAgentOnStdio`, and
  `registerBundledRuntime` + `BundledExtensions`/`BundledExtensionFactory` — the compiled-binary seam
  the CLI fills with the bundled extension factories and staged skills directory. Two subpaths exist for
  callers that need one half: `@thinkrail/pi-agent/acp` and `@thinkrail/pi-agent/engine`. The `bin`
  entry `thinkrail-acp-pi` is `src/main.ts`.
- **Allowed deps:** `@earendil-works/*` (pi); `@agentclientprotocol/sdk`; `@thinkrail/acp/meta`;
  `@thinkrail/contracts` (types only); `@thinkrail/shared/codedError`
  (the dependency-free error-code helper the subagent transcript reader throws with); `zod` (the SDK's main entry statically imports its generated zod
  schemas, so it is a real runtime dependency here exactly as it is in `packages/acp`); `typebox`; the
  `pi-*` capability packages, resolved **by path** for the dev loader and never value-imported;
  Bun/Node built-ins.
- **Forbidden:** `@thinkrail/server`, `@thinkrail/shared`, `apps/*`; `@thinkrail/acp`'s root or
  `testing` subpaths — this package is the *other end* of that protocol and shares only the `_meta`
  namespace, which is dependency-free for exactly this reason; the wire (`packages/contracts`) as
  anything but a type source.

## Sub-modules and dependency graph

`engine` (pi: runtime generations, sessions, skills, tools) · `acp` (the agent-side protocol face) ·
the package root (`index.ts`, `stdio.ts`, `main.ts`).

- `acp` → `engine` (**through its barrel**), `@thinkrail/acp/meta`, the SDK
- `engine` → pi, `@thinkrail/contracts` — and **never** `acp`, the SDK, or any ACP shape
- root → `acp`, `engine`

Acyclic, one-directional, and the direction is the point: pi flows outward into protocol, never the
reverse. `acp` reaches `engine` only through three injected seams (`setSessionEventSink`,
`setQuestionnaireAsk`, `setSessionToolsProvider`) plus plain calls on the barrel, so the engine can be
driven by something that is not ACP — which is exactly how its 142 unit tests still run.

## Decisions

- **The engine moved, it was not rewritten.** Every file under `engine/` arrived by `git mv` from
  `packages/server/src/agent`, with its tests and its spec. Decision #14 justifies owning the adapter
  partly on this: the working pi integration is the asset, and a rewrite would have thrown it away to
  re-earn it. The only engine edits are the three seams `acp` needs; the pi behaviour is untouched.
- **One process, many sessions.** `session/new` creates a pi `AgentSession` and leaves every other one
  alive. The community `pi-acp` closes all other sessions on both `session/new` and `session/load`,
  which would force ThinkRail into one agent process per chat tab; concurrent chats per workspace are a
  V1 requirement, so this is a hard difference, not a preference.
- **Capabilities are advertised only where they are served.** `loadSession`, `session/list`,
  `session/delete`, `session/close`, image + embedded-context prompts, and `providers/*` are advertised
  because they are implemented. `session/fork`, `session/resume`, `additionalDirectories`, `nes`, and
  every MCP transport are **absent**, which is the product's own rule turned inward: what an agent
  cannot do is missing, not broken ([[architecture]] Decision #16).
- **No auth surface at all, deliberately.** `authenticate`, `logout` and `authMethods` are not
  advertised and not implemented. pi's login is an interactive flow over `ModelRuntime.login`, and with
  the runtime now inside the agent process the host's existing provider-login surface no longer reaches
  it; the shape of the replacement (an ACP terminal auth method that re-invokes this binary, versus a
  host-side `_ext` request) is an open design question. Advertising `logout` with no way back in would
  be a trap, and a half-wired login worse than none.
- **`providers/*` is process-scoped and says so.** `providers/list` reports pi's real provider set with
  the API protocols its models declare; `providers/set` / `providers/disable` call pi's
  `registerProvider` / `unregisterProvider`, which take effect immediately for the running agent and are
  **not** persisted to `models.json`. That is honest for a session-lifetime override and wrong as a
  settings UI; the host should treat it as the former.
- **The binary is the agent.** Per Decision #5 the package is structured as publishable but is not
  published: `apps/cli` invokes `runPiAgentOnStdio()` under a subcommand, so `thinkrail acp-pi` is what
  the host spawns and one install still ships both halves.
- **Bundled extensions are registered by the launcher, not here.** `registerBundledRuntime` is
  re-exported unchanged, so the compiled binary keeps staging its skills and extension factories before
  the agent starts. `check:seams` follows the same seam to this package's bundle.

## Get right

- **Nothing in `engine/` may learn what ACP is.** The moment an ACP type appears there, an upstream
  break stops being a one-directory edit and the engine stops being testable without a protocol.
- **The `SessionToolBinding` must be filled before a prompt, and it is** — the statement after
  `createAgentSession` returns. A tool can only run inside a turn.
- **`disposeAllSessions()` on connection close.** The agent process outlives no connection; leaking pi
  sessions across a reconnect would leak provider work with them.
- **Session-file deletion no longer trashes.** `trash` and the OS recycle-bin helpers stayed with the
  host (`packages/server/src/trash`), so with no `setSessionFileRemover` injected, `session/delete`
  unlinks pi's session file. The user-visible transcript is the host's own record either way
  ([[architecture]] Decision #15), which is why this is acceptable rather than urgent.

## Later

- **`session/load` does not replay.** It attaches the session and answers, but emits no `session/update`
  history. ThinkRail does not need it; a published agent would. See `acp/SPEC.md` *Later*.
- **Provider login/logout** — the open question above; it needs a decision before the bundled agent can
  onboard a user who has never run pi.
- **`engine/SPEC.md` still carries wire-facing prose** from when it lived in the host. What moved is
  named at the top of that file; a line-by-line reconciliation is a follow-up, kept out of the move so
  the move stays reviewable.
