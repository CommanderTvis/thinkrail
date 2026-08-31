---
id: architecture
type: architecture-design
status: active
title: ThinkRail — top-level architecture
parent: goal-and-requirements
covers: [client-host-split, cli-entrypoint, wire-contract, transport-endpoint, ui-shell-panels, git-worktrees, remote-tailscale, hydrate-then-stream, domain-vs-view-state, frontend-local-workbench-frame, client-local-navigation, central-integration, acp-engine-boundary, first-party-pi-agent, host-owned-transcript, agent-capability-record, thinkrail-as-mcp-server, client-side-delegation]
tags: [v1, architecture, acp]
---

## Drivers

The product is built around **ACP agents**, each run as a **separate process** the host launches and
talks JSON-RPC to over stdio. V1 has two additive launchers over the same host library: the CLI boots the
engine host and opens a browser, while Electrobun packages that host with a native system-webview shell.
The desktop V1 profile is local only; a later shared-client profile can dial an existing host. The UI
ships independently of the host and dials it over the network; a phone reaches the selected host over
Tailscale.

## Topology — four rings

- **Engine host** (`packages/server` + `packages/acp` + `packages/shared`, launched by `apps/cli` or
  `apps/desktop` in local-host mode): owns agent processes, session state, **the transcript**,
  persistence, and serves the wire endpoint. It exposes ThinkRail's own tools to every agent as an MCP
  server.
- **The wire** (`packages/contracts`): the typed, versioned protocol — the only coupling between client
  and host. Agent-free: it names no agent and carries no ACP type.
- **UI client** (`apps/web`): a mobile-first React client, transport-driven and endpoint-configurable,
  shippable as static assets independent of the host.
- **Agents** (`packages/pi-agent` + anything on the ACP registry): separate processes speaking ACP.
  ThinkRail's own pi agent is bundled and default; others are selected or installed by the user.

```
apps/cli        host launcher: boot server + open browser        ── depends on ─▶ packages/server
                also the agent entrypoint: `thinkrail acp-pi`    ── depends on ─▶ packages/pi-agent
apps/web        UI client (mobile-first)                          ── depends on ─▶ packages/contracts
apps/desktop    Electrobun local-host launcher (V1)               ── depends on ─▶ packages/server, packages/contracts, packages/shared
apps/website    public landing + blog + /vibecoding (Cloudflare Pages) ── depends on ─▶ packages/website-analytics
packages/website-analytics  dependency-free browser analytics policy for the public website
packages/server createServer(): Bun.serve(HTTP+WS) + AgentSessionManager (ACP client) ── depends on ─▶ packages/contracts, packages/acp, packages/shared
packages/acp    the ACP client: spawn, negotiate, translate       ── depends on ─▶ @agentclientprotocol/sdk
packages/contracts  the wire (types-only, agent-free)
packages/shared     shellEnv (server-side only)
packages/pi-agent   first-party ACP agent wrapping pi             ── the ONLY package that may import pi
packages/spec-graph portable agent capability: spec_* tools (registered natively by pi-agent, exposed
                    over MCP to every other agent; its agent-free core/ read model also backs the
                    host's spec.graph read method)
packages/visualize          portable agent capability: the visualize tool
packages/todos              portable agent capability: the todo_* tools
packages/thinkrail-workflow the workflow skill system + its always-on routing rule — pi-agent only,
                    with its skill documents exposed as MCP prompts elsewhere
```

## Decisions

1. **Client/host split.** Engine host owns agent processes and state; the UI is a portable client; the
   wire is the only coupling. **Rule: `apps/web` depends on `packages/contracts` only** — never on
   `server`, `shared` or `acp`. That single edge is what makes the UI shippable without the host.
2. **Launchers are thin; the host is a library.** `apps/cli` is a thin launcher
   (`resolveShellEnv` → `createServer` → open browser → signal handling). `apps/desktop` keeps that local
   profile with a native window and may also run as a shared client without starting a second host; both
   profiles use the same wire and web artifact. The same binary is **also** the bundled agent:
   `thinkrail acp-pi` runs `packages/pi-agent` on stdio, which is how the host launches it.
3. **The wire is versioned — and now carries two versions.** `contracts` is types-only; `server.welcome`
   carries ThinkRail's protocol version so an independently-shipped UI can detect host-version drift,
   **and** the ACP protocol version negotiated with the active agent, so the UI can explain a capability
   gap that comes from the agent rather than the host.
4. **Transport endpoint is a parameter.** Defaults to same-origin (`location.host`); a remote browser,
   desktop, or mobile client points it at the selected host's Tailscale MagicDNS name. Native resume state
   is keyed by backend profile so ids from one host are never interpreted against another.
5. **UI = panels + shell.** Layout-agnostic, store-driven panels (project→workspace nav, file tree,
   Monaco editor, changes/diff, workspace-local review, terminal, chat, composer) never know their
   arrangement. Each desktop frontend window owns one locally persisted, resource-free workbench frame: a
   recursively split center plus auxiliary groups in vertical left/right stacks and a horizontally grouped
   bottom region. The frame's topology, singleton-tool placement, visibility, folds, geometry, and alignment
   remain unchanged when that window switches workspace; workspace-scoped resources and attention project
   into it from separate local views. Terminals may occupy center or auxiliary groups, with new workspaces
   defaulting one terminal to bottom. Another window never rearranges this one. A future mobile shell may
   project the same panels differently; desktop docking does not define that projection. Detail:
   [[submodule-web-shell-layout]].
6. **Workspaces are git worktrees (V1).** project (git repo) → workspace (`git worktree` on its own
   branch/cwd, under `~/.thinkrail/worktrees`) → {chats, files, terminals}. **Two deliberate
   exceptions, both `kind`-marked on the wire and both *user-owned* — never renamed or reclaimed by
   ThinkRail:** every project carries exactly one built-in **Default workspace** (`kind: "default"`)
   whose cwd is the project folder itself (git's *main working tree*) — non-removable, non-renamable,
   and entered explicitly from the project's Welcome fork ("Work in project folder"), never
   auto-entered — the "just work in my project folder" anchor for users lost in the
   worktree model; and an **existing worktree** the user explicitly attaches in place
   (`kind: "external"`), which ThinkRail may forget but never mutates (see
   [[submodule-server-workspaces]]). The shell is built first,
   the agent connected last. **Open PR is V1**: a deterministic, host-side push + open/update of the
   branch's GitHub PR through the user's own `gh` CLI (no stored tokens, no provider REST API), body
   rendered from the verified plan, with a compare-URL fallback when `gh`/GitHub isn't available (see
   [[submodule-server-pr]]). CI/Checks status, merge/squash from the app, and `glab` support stay V2;
   workspace-local Review is V1.
7. **Auth is external.** Tailscale ACLs / device identity are the auth; the app carries an `owner` field,
   not a login UI. (Distinct from *provider* credentials, which belong to the agent and are reached
   through ACP `authenticate` / `providers/*`.)
8. **Hydrate-then-stream (every client reconstructs from the host).** A client never relies on having
   *witnessed* events to know state — on connect it **reads** the current state, then **subscribes** to
   live deltas. The host exposes the read side of the wire (`project.list` / `workspace.list` /
   **`session.list`** / **`session.getMessages`**) alongside the `chat.event` delta stream. So a reload, a
   second tab, a phone, or a **host restart** all rebuild the same view: `session.list` unions the host's
   live sessions (auto-restored as tabs) with **the host's own transcript store** (surfaced in
   chat-history, re-opened on demand via `session.getMessages`). The client is a **stateless projection**,
   never a second source of truth. A prompt turn is settled when `session/prompt` resolves with a
   `stopReason` — ACP has no attempt-level boundary, so there is no `agent_end`-versus-settled hazard;
   where an agent reports attempt-level retries or compaction through the ThinkRail `_meta` namespace,
   those are rendered as progress within the same unsettled turn.
9. **Domain state, shared placement, and local attention.** *Domain* state — projects, workspaces,
   **sessions + their transcripts**, terminals, git — is backend-owned, shared, and persistent; every
   client hydrates it from the host. Workspace **placement state is deliberately shared too**: one
   versioned host document owns center plus left/right/bottom auxiliary topology, open resource references,
   tab order, preview identities, folds/visibility, and normalized geometry. Layout schema version 2 adds
   bottom explicitly and migrates known version-1 documents to hidden/empty bottom without moving a resource;
   a generic region map was rejected as an unnecessary rewrite of stable side contracts, while a separate
   bottom snapshot would make cross-region moves non-atomic. A migrated snapshot is reported at revision 2
   or later, so revision 1 identifies a first persisted version-2 layout—but not the age of its workspace.
   Default-terminal seeding additionally requires the host-owned `Workspace.initialTerminalEligible` marker,
   written only when a workspace record is first created; legacy records are never backfilled. Valid full
   snapshots converge by monotonic revision, but
   replacement is optimistic-concurrency guarded: a client names its exact accepted revision
   (or create-only absence), and a stale full replacement conflicts with the current snapshot instead of
   making the last arrival win. Left/right/bottom visibility, folds, extents, and bottom alignment are
   structural; this remains placement only, never resource lifetime. *Attention and drafts* — selected tab per
   group, last-focused group, uncommitted pointer/resize drafts, composer drafts — remain
   per-client (ephemeral or local reload persistence), so one browser cannot steal another's focus. The active
   client location is likewise local: one backend-relative route names main / Project Home / workspace / exact
   chat; web stores it in a versioned fragment, while later native shells persist it per backend profile and
   window/device. Incoming ids are validated against hydrated host state, and no backend-owned “current screen”
   lets one client move another.
   Corollary: closing a file/chat placement is a shared view action, not a domain dispose — the session
   remains; terminal close retains its separate explicit PTY-lifetime semantics. Detail:
   [[submodule-server-layout]] and [[submodule-web-shell-layout]].
10. **Dependencies pin exact versions.** Every dependency in every manifest pins an **exact** version — no
    ranges (`^` `~` `>` `<` `.x` `*`). Rationale: `pi` ships breaking releases daily and the ACP SDK is
    pre-1.x in spirit (much of its surface is marked UNSTABLE), so a floating range is a live wire; more
    broadly, a silent minor/patch bump is the classic irreproducible-build trap. Exact
    pins make the lockfile the single source of a dependency's version and turn every upgrade into an
    explicit, reviewable diff. Cross-cutting deps (pi, the ACP SDK, TypeScript, typebox, bun types) are
    pinned **once** in the root `workspaces.catalog` and referenced via `catalog:`, so their version lives
    in exactly one place.
    **Enforced**, not just documented: `scripts/check-catalog.ts` (`bun run check:deps`, in pre-commit + CI)
    rejects any range, any catalog drift, and a lockfile graph that resolves `react` or `react-dom` outside
    its one catalog pin (the temporary prerelease override rationale belongs to [[module-web]]). Exempt:
    `peerDependencies` (agent-capability packages declare `"*"` on purpose — the host provides the dep) and
    local protocols (`workspace:` / `link:` / `file:`). An exact SemVer prerelease/build suffix is still an
    exact pin (`19.3.0-canary-a1124489-20260826`); the checker accepts the full identifier grammar,
    including hyphens, without admitting a range.
    **A user-installed agent is outside the lockfile's reach entirely** — see Decision #20 for how its
    version is pinned instead.

11. **Terminal = xterm.js on the DOM renderer.** The browser terminal is `@xterm/xterm`, driven from
    `apps/web/src/panels/TerminalInstance.tsx` against a real PTY (`bun-pty`) in
    `packages/server/src/terminal`. It stays the choice because it is the only production-ready browser
    terminal: the credible alternatives are all Ghostty's VT engine compiled to WebAssembly (`ghostty-web`,
    `restty`, `wterm`), and the most mature of them has a single tagged release that can do neither mouse
    reporting nor OSC 8 links — vim/htop/lazygit would regress. **The renderer is deliberately the default
    DOM one**, not `addon-webgl`: xterm's own maintainer names the DOM renderer a prerequisite for touch
    support, and WebGL carries defects we would inherit (`WebglAddon.dispose()` leaks its WebGL2 context —
    fatal for our per-worktree terminal churn — plus iOS context-limit crashes). Loading `addon-webgl` would
    be a regression, not an upgrade; ligatures and `rescaleOverlappingGlyphs` are the accepted cost. Coupling
    is kept deliberately thin (about a dozen xterm API members; no parser hooks, decorations or
    serialization), so a swap stays a contained rewrite of one file. **Re-evaluate when both** (a) upstream
    tags `libghostty-vt` with an official WASM/npm distribution, and (b) `ghostty-web` ships past 0.4.0 with
    mouse reporting and OSC 8 working.
12. **A shell belongs to a tab, and the host owns the mapping.** Terminals are keyed by
    `(workspaceId, tabKey)`; `terminal.reserve` may durably establish the catalog tab without a process, while
    one idempotent `terminal.attach` remains the only way its PTY is born. Reservation persists before
    publishing membership and rolls back its in-memory insertion if persistence fails. This separation lets a
    synchronized hidden default placement survive reload and another client without starting a shell. The
    client keeps no tab→shell pointer of its own. Shells are **owner-scoped**, matching `history`/`todos`/`templates`, so
    they survive a reload, a closed browser and a different browser — attach is exclusive, and taking a tab
    over notifies the displaced client. Lifetime is bounded by reference (no tab → no shell) plus the host
    process, **not** by timers: no idle culling, no abandoned-client reap. A host restart cannot preserve
    shells (PTY hangup on host exit), so tabs are revived with fresh shells showing recorded output.
    **tmux was rejected** as the persistence layer: an unassumable dependency on Windows, a competing tab
    model, env-propagation breakage, and polling-based capture — for restart survival we have already
    decided not to hold. Detail: [[submodule-server-terminal]].
13. **Central's cross-module lifecycle has one architectural owner.** Its adapter, runtime generation,
    wire status, and card remain in their bounded modules; the correspondence between those surfaces and
    their liveness obligations belongs to [[central-integration]]. This keeps feature-specific mechanics in
    their leaf specs while making a non-terminating composition visible at the architecture layer.

13. **ACP is the engine boundary, and it is a process boundary.** The host is an ACP *client*. It spawns
    an agent, speaks JSON-RPC over its stdio, and knows nothing about how the agent reaches a model. This
    replaces the in-process engine outright and **reverses V1's accepted no-crash-isolation tradeoff**: a
    fatal agent or provider fault kills one process the host supervises, restarts and reports, instead of
    taking the host down with it. It also retires a whole regression class — the agent's dynamic imports
    are no longer the host binary's problem.
14. **We own the pi adapter (`packages/pi-agent`).** ThinkRail's pi support is a first-party ACP *agent*
    we ship, not a third-party adapter we consume. The community `pi-acp` was evaluated and rejected on
    facts: it accepts `session/new`'s `mcpServers` and discards them (so ThinkRail's tools could never
    reach pi through it), it closes every other session on both `session/new` and `session/load` (so
    concurrent chats are impossible), and it delegates neither `fs/*` nor `terminal/*` (so pi would escape
    worktree scoping). Owning it costs little — today's working pi integration *moves* into it rather than
    being rewritten — and buys the ability to carry pi's extra signals through the protocol instead of
    losing them. **`packages/pi-agent` is the only package in the repo permitted to import pi.**
15. **The host owns the transcript.** `packages/server/src/transcript` appends every session update to a
    ThinkRail-owned, per-session record under `~/.thinkrail`. Rationale: ACP's `session/load` and
    `session/list` are *optional* capabilities that many agents skip, so anything built on the agent's
    memory would be "works with some agents, silently missing with others" — the worst outcome for a
    product whose pitch is a consistent workspace. Our own record makes history, cross-project search,
    prompt recall, jump-to-message, closed-chat reopen and chat delete behave identically everywhere.
    This narrows — but does not repeal — the old "the agent owns state" rule: the host still never
    **recomputes** what the agent reports (cost, usage, context size), it only records what it is told.
    Accepted cost: chats started outside ThinkRail are no longer in the search corpus.
16. **Capability record: negotiated once, carried on the wire, obeyed by every panel.** At connect the
    host folds `initialize`'s `agentCapabilities`, the agent's advertised ThinkRail `_meta` extensions,
    and the registry's per-agent profile into a single `ChatCapabilities` record, then **widens it by
    observation**: plans, slash commands, usage and config options are push-only in ACP — no capability
    field announces them — so a record frozen at connect could only ever say `false` for an unknown
    agent. First arrival of such a surface widens the record, provenance `observed`. Panels **read that
    record** — they never probe the agent, and they never branch on which agent is running. **What an
    agent cannot do is absent from the UI, not greyed out**, with a small badge naming the active agent so
    absence is explained rather than mysterious. Where the host can honestly emulate a missing capability
    it does, and the record says so: mid-turn steering becomes a held message dispatched at turn end;
    history comes from Decision #15's transcript. Where it cannot, the feature is simply not there.
17. **ThinkRail exposes its own tools to agents as an MCP server.** ACP has no way for a *client* to push
    tools or prompts into an agent — `available_commands_update` is agent→client only — so ThinkRail's
    `spec_*`, `todo_*` and `visualize` capabilities reach an external agent the way Zed shares its MCP
    servers: as an entry in `session/new`'s `mcpServers`. Preferred transport is **`McpServerAcp`**, which
    carries MCP over the ACP connection itself (`mcp/connect` / `mcp/message` / `mcp/disconnect`) — no
    port, no token, no third process — falling back to `McpServerHttp` on the existing `Bun.serve` when
    the agent does not advertise `mcpCapabilities.acp`. `packages/pi-agent` registers the same tools
    natively and skips the MCP hop entirely. Each capability package therefore splits three ways: an
    agent-free `core/`, agent-free tool definitions, and thin `pi/` + `mcp/` registrations over them.
18. **The client delegates its filesystem and its terminals.** The host advertises
    `fs.readTextFile` / `fs.writeTextFile` and `terminal`, and implements every `fs/*` and `terminal/*`
    method against ThinkRail's worktree-scoped filesystem and its real PTYs. So an agent's edits pass
    through the host (making unsaved editor buffers visible to it) and an agent's commands surface as
    watchable ThinkRail terminals in the right worktree, instead of running out of sight. `pi-agent`
    routes pi's own file and bash tools through the same path. **Known future rework:** the ACP v2 draft
    removes client-side fs and terminals; Decision #19 is what keeps that a contained change.
19. **ACP shapes stop at one translation module.** `packages/acp` is the only place in the repo that may
    import an ACP type. Everything past it — `contracts`, `server`, `web` — speaks ThinkRail's own
    transcript and event model. This is deliberate insurance: much of the surface this design leans on
    (`McpServerAcp`, elicitation, `Usage`, `ToolCall.name`, `providers/*`, `session/fork`) is marked
    **UNSTABLE** in the shipped schema, and the v2 draft is a moving target. Isolation makes an upstream
    break an edit to one module plus its unit tests, rather than a second rewrite.
    The ThinkRail extension surface has **two channels, both confined to that module**: the `_meta`
    namespace on ACP messages carries push signals (Decision #6's retry, compaction, queue depth,
    steering), and ACP's `_ext` request/notification methods carry the small number of request/response
    extras a push channel cannot express (the skills catalog and resource reload).
20. **Agents are selected or installed, and their versions are ours to pin.** A user can point ThinkRail
    at any ACP agent already on their system from the terminal, or install one in-app from the ACP
    registry (`cdn.agentclientprotocol.com/registry/v1/latest`) into `~/.thinkrail`. The bundled pi agent
    needs neither and remains the default, so the one-file install promise survives: git plus an
    authenticated provider. Installing into our own directory is also the only way a separate program's
    version can be pinned at all — Decision #10's lockfile cannot reach it.
21. **The public website is one origin, artifact, and production deployment.** `apps/website` owns `/`,
    `/blog/`, and `/vibecoding/` in one static Astro build deployed through one Cloudflare Pages project.
    React and Tailwind are permitted only inside [[submodule-website-vibecoding]]; unrelated routes retain
    their vanilla runtime and hand-written stylesheet. Browser analytics and consent initialize once on the
    exact `thinkrail.ai` origin. The retired `vibecoding.thinkrail.ai` hostname is an edge redirect that
    preserves path and query, never a proxy to a second site.

15. **Desktop packaging preserves the host/runtime boundary.** Electrobun `1.18.1` packages Bun `1.3.14`
    and embeds the host in its Bun process; it never wraps or spawns the CLI. The native window loads the
    packaged web build from the host's actual loopback port so UI, wire, files, and SPA fallback keep one
    origin. Native resources that require paths stay unpacked. The shell sets the staged `bun-pty` library
    before server import and loads PI from a separately bundled `.ts` runtime so external TypeScript
    extensions receive PI's bundled virtual modules rather than nonexistent built-Node aliases. The CLI
    and desktop acquire the same canonical-data-directory ownership lease and share graceful shutdown.
    Desktop artifacts are additive and unsigned initially; native WebKitGTK on Ubuntu 24.04+/glibc 2.38 is
    the supported Linux floor. Detail: [[module-desktop]].

16. **Delegation is portable; ThinkRail is one embedder.** `packages/pi-delegation` owns the session
    fabric: one creation primitive with orthogonal axes, a run-owning handle, lineage, registry, and
    lifecycle events. `packages/pi-subagents` consumes it to expose the `Agent` tools. Both work under
    vanilla pi with the SDK as a `peerDependency` (peer deps are exempt from the exact-pin rule,
    decision #10), create in-process hidden pi sessions, and keep their host bindings optional.
    ThinkRail composes them in `packages/server`: one service per workspace, child transcripts under
    the host data dir, a curated child-extension set, and the exact `ModelRuntime` retained by each
    parent session so children stay on that parent's provider generation across Central changes. The
    wire mirrors only the UI-facing run details and exposes transcript reads; neither portable package
    depends on ThinkRail. Contract, semantics, and the full decision log:
    [[module-pi-delegation]], [[module-pi-subagents]], and [[submodule-server-agent]].

## Invariants

- **`packages/pi-agent` is the only package that may import `pi`.** Nothing else in the repo — not
  `server`, not `contracts`, not `web`, not the capability packages' `core/` or tool definitions — may
  value-import or type-import a pi package.
- **`packages/acp` is the only package on the *client* side of the protocol that may import an ACP
  type.** `packages/pi-agent` implements the *agent* side of the same protocol and necessarily imports
  the agent-side types; the two share only `packages/acp/src/meta`, which is dependency-free by design.
  Past that boundary nothing knows ACP exists: `contracts` names no ACP shape, and `apps/web` has no
  idea what protocol the host speaks to agents.
- One id model: the UI tab id **is** the session id the host uses for the agent's ACP `SessionId`. No
  third identifier.
- The agent runs as a **separate process with crash isolation** — the host supervises, restarts and
  reports a fatal agent fault instead of dying with it.
- The agent owns model choice, prompt assembly and cost; **the host owns the transcript**. The host
  **exposes** what the agent reports through read methods and never recomputes it, and it **records**
  what it is told rather than deriving it.
- **Streaming has three write modes, not two:** a text/thinking *chunk* **APPENDS** (grouped by
  `messageId`); a whole *block* — an image, a resource, a tool call — is **SET** (it arrives complete
  rather than streamed); a `tool_call_update` **REPLACES** the fields it names on the matching tool
  call.
- A prompt turn is settled when `session/prompt` resolves. Errors arrive as JSON-RPC errors and as
  transcript entries, not as a crash signal — wrap each call and forward to the WS client.
- **UI panels are layout-agnostic**; the shell arranges them (desktop multi-pane / mobile single-view).

## Out of scope (V1)

The workflow **product layer** (a runtime/engine, configurable pipelines) — the skill-based workflow
*system* ships in V1 inside `packages/pi-agent` (`module-thinkrail-workflow`: skills + one always-on
rule, no runtime machinery), with its skill documents exposed as MCP prompts to other agents; the
spec-graph **product layer** beyond the read-only viewer (drift detection, pre-build
approval, living graph) — the agent-side spec-graph *capability* ships in V1 as
`module-spec-graph`, and the V1 viewer is a read-only Specs tab over a `spec.graph` wire read;
PR/Checks automation beyond push + open/update via `gh` (CI/checks status, merge or squash from the
app, provider REST API integration, `glab` — see [[submodule-server-pr]]), self-improvement, automations, per-step model routing, cost ledger.
