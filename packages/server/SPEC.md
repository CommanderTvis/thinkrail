---
id: module-server
type: module-design
status: active
title: Engine host (server library)
parent: architecture
depends-on: [module-contracts, module-acp, module-shared]
tags: [v1, host]
---

## Responsibility

The engine host as an embeddable library. Serves the browser↔host wire (`Bun.serve` HTTP+WS, static SPA)
and drives **ACP agent processes** through `agent`, the host's session manager over `@thinkrail/acp`.
Launched in-process by `apps/cli` and the
Electrobun `apps/desktop`; it has no standalone entrypoint of its own
(a `dev.ts` boots it for development / e2e).

## Boundary

- **Owns:** the HTTP+WS server, static serving, the WS dispatch registry, server-side feature services
  (project/workspace/git/fs/terminal + the **ACP session manager** and the **transcript store**), and
  `~/.thinkrail` persistence.
- **Public surface:** `createServer(options) → Promise<RunningServer>` (`{ port, stop, shutdown }`) —
  `stop()` is synchronous resource disposal for low-level tests while `shutdown()` is the idempotent,
  bounded production lifecycle (dispose agent sessions + drain analytics, then release sockets/PTYs/
  watchers and any attached ownership lease) every launcher must await — the public
  factory starts Central artifact watching and binds the agent-credential resolver before binding a
  socket or exposing handlers, so every embedder gets the same bootstrap invariant — and
  `bootHost(options) → BootedHost` (the process-boot wrapper: resolves the login-shell PATH, pre-warms the
  same initialization before choosing a port, awaits
  `createServer`, and installs SIGINT/SIGTERM graceful-shutdown handlers), both re-exported from
  `host/`. **`registerBundledRuntime` is gone from this package** — the pi runtime's binary seam moved to
  `packages/pi-agent` with the engine, so nothing here knows what pi needs to boot. What the root barrel
  does carry for a launcher is the **pre-boot seam**: `setBundledAgentLaunch` (how to re-invoke ThinkRail
  as its own agent — `apps/cli` owns that spelling, this package only holds it), `setBundledTrashHelpers`
  (the native recycle-bin helpers a compiled binary stages to real paths), and the two names a launcher
  must spell **identically** to the host or corrupt its state — `dataDir` for the uninstaller and
  `agentsDir` + `BUNDLED_AGENT_ID` for `thinkrail agent`, which writes the same catalog `agent/` reads.
  The package also exposes the **`@thinkrail/server/agent` subpath export** (the `agent` barrel): the
  server-side session surface for the **headless workflow-test harness** (`e2e/workflows/`), which
  drives real sessions through the production wiring without booting the HTTP host — a
  deliberate second entry that avoids evaluating `host` (Bun-only: `Bun.serve`, `bun-pty`) under the
  node-run e2e worker. Not for `apps/*` use — the web/CLI boundary rules are unchanged.
- **Allowed deps:** `contracts` (types + WS constants), `acp` (the ACP client), `shared` (`shellEnv`, the Central adapter, and the
  retrying teardown helper the artifact probes clean up with),
  `bun-pty`, `pino` + its pretty/rolling destinations (host diagnostics), Bun/Node.
- **Forbidden:** importing `web`/`cli`/`desktop`; being bundled into the browser; **any pi package**;
  **any ACP type or the ACP SDK** — the protocol stops at `@thinkrail/acp`
  ([[architecture]] Decision #19), and `scripts/check-architecture.ts` enforces both.
- **Deployment obligation:** product behavior lives in the owning server feature module and is composed by
  `host`; launchers only supply boot options and packaged resources.

## Internal modules

Each lives in `src/<name>/` as a bounded sub-module: a `SPEC.md` (its own boundary) + an `index.ts`
**barrel** that is its only public surface. Siblings import a module **through its barrel, never its
internals**. The edges between them are owned here (see the dependency graph), not in the leaf specs.

| module | owns | spec |
| --- | --- | --- |
| `host` | `Bun.serve` HTTP+WS, static SPA, the WS dispatch registry, channel publish | [host/SPEC.md](src/host/SPEC.md) |
| `persistence` | JSON domain/config state under the data dir | [persistence/SPEC.md](src/persistence/SPEC.md) |
| `log` | explicit leveled diagnostics → pretty stderr + agent-oriented JSONL under `<dataDir>/logs` (pino-roll daily/10 MB rotation, 14 rotated + active); arbitrary console output stays terminal-only | [log/SPEC.md](src/log/SPEC.md) |
| `settings` | server-synced app config, including the shared custom-layout-preset catalog (never current/default layout) | [settings/SPEC.md](src/settings/SPEC.md) |
| `projects` | stable known-repo registry: open/recent views + lossless close/reopen (validate, dedupe, slug) | [projects/SPEC.md](src/projects/SPEC.md) |
| `workspaces` | workspaces = `git worktree`s on their own branch | [workspaces/SPEC.md](src/workspaces/SPEC.md) |
| `git` | the `git(cwd, args)` runner + worktree status/diff vs base + branch list | [git/SPEC.md](src/git/SPEC.md) |
| `subprocess` | `runBounded(argv, …)`: one child, one budget, killed by process group on expiry | [subprocess/SPEC.md](src/subprocess/SPEC.md) |
| `github` | read-only local `gh` auth status (shell-out) for the New-Workspace surface | [github/SPEC.md](src/github/SPEC.md) |
| `branch-review` | best-effort open GitHub PR / GitLab MR number for a workspace branch | [branch-review/SPEC.md](src/branch-review/SPEC.md) |
| `pr` | `pr.open`: push the workspace branch + open/update its GitHub PR, body rendered from the plan | [pr/SPEC.md](src/pr/SPEC.md) |
| `fs` | read/write dirs + files inside a worktree (path-contained) | [fs/SPEC.md](src/fs/SPEC.md) |
| `spec` | the worktree's spec-graph snapshot (`spec.graph`) + project-level `projectHasSpecs`, via `pi-spec-graph/core` | [spec/SPEC.md](src/spec/SPEC.md) |
| `todos` | a chat's per-session TODO plan read/write (`todo.*`), via `pi-todos/core` | [todos/SPEC.md](src/todos/SPEC.md) |
| `reviews` | draft review comments on files/diffs: store + anchoring + context-package render | [reviews/SPEC.md](src/reviews/SPEC.md) |
| `watch` | per-worktree fs watcher → debounced `workspace.fsChanged` invalidation push | [watch/SPEC.md](src/watch/SPEC.md) |
| `terminal` | workspace-scoped `bun-pty` terminals, including the agent-owned ones | [terminal/SPEC.md](src/terminal/SPEC.md) |
| `transcript` | the host-owned append-only record of every chat | [transcript/SPEC.md](src/transcript/SPEC.md) |
| `agent` | the ACP session manager: agent resolution, process supervision, client-side delegation, session lifecycle | [agent/SPEC.md](src/agent/SPEC.md) |
| `auth` | the agent's credential surface (auth methods, providers) plus native JetBrains Central orchestration | [auth/SPEC.md](src/auth/SPEC.md) |
| `assist` | pure workspace-naming helpers over a transcript (no model, no I/O) | [assist/SPEC.md](src/assist/SPEC.md) |
| `analytics` | anonymous usage analytics: closed event set → PostHog sink (privacy contract in its spec) | [analytics/SPEC.md](src/analytics/SPEC.md) |
| `dialog` | the host's native folder picker | [dialog/SPEC.md](src/dialog/SPEC.md) |
| `editors` | detect installed editors/IDEs, launch one at a worktree, reveal a worktree in the file manager | [editors/SPEC.md](src/editors/SPEC.md) |
| `history` | prompt recall + conversation search over the transcript corpus | [history/SPEC.md](src/history/SPEC.md) |
| `templates` | file CRUD over ThinkRail's prompt-template dirs (global + project scoped) | [templates/SPEC.md](src/templates/SPEC.md) |

`src/index.ts` re-exports `host`, and explicit package subpaths expose build support and artifact
probes without widening the runtime barrel; `persistence`'s `dataDir`, `trash`'s `setBundledTrashHelpers` and
`agent`'s `setBundledAgentLaunch` / `agentsDir` / `BUNDLED_AGENT_ID` — the pre-boot seam above, and the
only names a launcher may reach; `src/dev.ts` boots the host from env via `bootHost` for dev/e2e.

## Internal dependency graph

`host` is the **only composition root** — it wires each feature's handlers into the WS registry.

- `host` → `projects`, `workspaces`, `git`, `github`, `branch-review`, `pr`, `fs`, `spec`, `todos`, `reviews`, `watch`, `terminal`, `dialog`, `editors`, `agent`, `auth`, `assist`, `settings`, `history`, `templates`, `analytics`, `log`, `persistence` (`dataDir`, for the crash report), **and `@thinkrail/acp`'s registry exports** — the one external edge, confined to `host/agentInstall.ts`, because `agent` declined `agent.registry`/`agent.install` and the data dir plus the download belong here. It names no ACP protocol type.
- `workspaces` → `projects`, `git`, `persistence`
- `branch-review` → `git`, `subprocess`
- `pr` → `workspaces`, `git`, `todos`, `branch-review` (provider detection + gh-output parsing + the shared CLI runner), `github` (`ghSetupProblem` — the named compare-fallback reason)
- `projects` → `git` (shared runner), `persistence`
- `git` → `subprocess` (every child that talks to a network or another CLI)
- `git`, `fs`, `spec`, `watch`, `terminal`, `settings`, `analytics`, `templates` → `persistence` (`spec` also → `pi-spec-graph/core`, external; `analytics` also → `posthog-node`, external — the delivery SDK, its pi-catalogue edge gone with the model params; `templates` also → `shared`'s `WORKSPACE_INTERNAL_DIR`, its project scope being `<cwd>/.thinkrail/prompts` now)
- `log` → `persistence` (`dataDir`) — and **any feature module (+ `host`) may → `log`**: it is the one
  cross-cutting edge, like `persistence`, exempt from the never-each-other rule. `persistence` never
  imports `log` (would cycle); `initLogging` is called only from `host`'s `bootHost`
- `todos` → `workspaces` (worktree path lookup) + `pi-todos/core` (external, value-imported, pi-free)
- `reviews` → `workspaces` (worktree path lookup), `persistence` (data dir), `git` (the review's baseSha
  resolve, plus the diff range + blob read behind a base-side anchor). The `review.send*` flows are
  **composed in `host`'s handlers** (reviews builds the package, `agent` runs the session — no
  `reviews`→`agent` edge; `host` serializes sends *and* review mutations per workspace via
  `reviewLock`). The agent-side `resolve_comment` tool is now an MCP tool an agent calls back
  through ThinkRail's own MCP server, not a seam `agent` installs — see [[submodule-server-agent]]'s
  `McpToolServer` port, which `host` binds.
- `assist` → (leaf). It was `assist` → `agent` for the one-shot completion primitive; ACP has no
  non-session inference, so that helper and its edge are **deleted**, not ported. What is left is pure
  text-in/text-out over `contracts` types — see [[submodule-server-assist]].
- `auth` → (leaf). Credentials belong to the agent now, so what `auth` needs is one live connection's
  credential half — but it takes that as an injected `AgentCredentials` port `host` binds, not as an
  `auth` → `agent` edge, which keeps `agent`'s much larger surface out of reach and the whole module
  testable with no process. Rationale: [[submodule-server-auth]].
- `agent` → `transcript`, `fs`, `terminal`, `persistence`, and the external `@thinkrail/acp`. The last
  three are reached **only** through `agent/hostPorts.ts`, which binds them to injected ports — so every
  other file in `agent`, and every suite there bar the one that deliberately drives the real `fs`
  containment guard, runs with no PTY, no worktree and no data dir.
  `agent` imports no other sibling, and **no sibling imports it** — `host` is its only caller.
- `transcript` → `persistence` (`dataDir`), `trash`
- `history` → `transcript` (the search corpus; read-only, no other sibling)
- `persistence`, `dialog`, `github`, `assist`, `subprocess` → (leaves)

Rules: features never import `host`, and never each other except the edges above. The graph is acyclic.
`agent`'s WS surface (`session.*` / `agent.*` plus the `chat.event`, `agent.permission`,
`agent.elicitation` and `session.deleted` channels) attaches to `host`. Features that push on their
own never import `host` either: they expose a **publisher-injection seam** (`setTerminalPublisher`,
`agent`'s `setAgentPublishers` (one record carrying all four of its channels),
`projects`' `setProjectPublisher` for the full-snapshot
`project.updated` lifecycle, `workspaces`' `setWorkspacePublisher` for the
`workspace.created`/`updated`/`removed` lifecycle trio, `settings`' `setSettingsPublisher` for
`settings.changed`, `reviews`'
`setReviewPublisher`, `watch`'s publish + repo-metadata callbacks, and auth's Central action
analytics + `agent.changed` invalidation publishers) that `host` installs at `createServer` — so
channel/analytics wiring lives only in `host`. **One seam is deliberately left uninstalled**: `watch`'s
`setSkillPathClassifier` — the host has no notion of a skill path now that skills are agent-side.
`auth`'s `setAgentCredentials` **is** bound, in `host/agentCredentials.ts`, from six credential methods
`agent` exposes on `AgentSessionManager` rather than a live `AgentConnection` reaching `host` directly —
see [[submodule-server-host]] and [[submodule-server-agent]].
For layout writes, `host` passes the current side + bottom group-limit policy from
`settings.getConfig().layout` into the `layout` validator;
for layout-setting writes it runs the complete nested value through `layout.validateLayoutSettings` before calling `settings`.
Neither sibling imports the other.
`history` stays registry-free (never imports `projects`/`workspaces`); `host` injects the scope
callbacks from the registries at the handler layer (`history.search` handler), and they now receive a
whole corpus session — `workspaceId` comes off the transcript, so only `projectId` is resolved
there. `templates` stays
registry-free too — it takes a plain `cwd`, never a `workspaceId`; the `template.*` handler resolves
`workspaceId` → `cwd` via `workspaces` before calling into `templates`.

Analytics is host-mediated the same way: **every `track()` call site lives in `host`** (boot,
chat-start, a successful `agent.authenticate` and a successful Central connect), and `host` syncs
`setAnalyticsSending` off the settings broadcast — `analytics` has no `settings` edge and no feature
module knows analytics exists.

## Get right

- **Agents are separate processes and the host survives them.** [[architecture]] Decision #13 reverses
  V1's accepted tradeoff: a fatal agent or provider fault kills one supervised child, which `agent`
  restarts and reports as an `AgentStatus`, instead of taking the host down.
- **One writer per data dir** — every production launcher enters through `bootHost`; ownership is a
  kernel-held loopback listener keyed by the canonical data-directory fingerprint, not a staleable file.
  Same-owner refusal is immediate, different-owner port collisions advance deterministically, and an
  occupied endpoint that cannot prove its identity fails closed.
- **WS commands return values directly**; only events + extension-UI use push channels.
- Binds beyond localhost via `host` option (the Tailscale seam).

## Later

Persistence behind a data layer (V2), `owner` threading.
