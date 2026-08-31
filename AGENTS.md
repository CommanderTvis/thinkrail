# ThinkRail

A ThinkRail-branded desktop-and-mobile client for **ACP coding agents**. The app is a thin host that
launches an agent as a separate process and bridges it to a rich UI; the agent owns models, skills,
compaction, cost and its own session state. ThinkRail ships its own first-party pi agent.

Canonical specs (read these first):
- `goal-and-requirements.md` — product goal + V1/V2 scope
- `architecture.md` — top-level architecture, decisions, invariants

## Module structure & boundaries (top-priority requirement)

The app is built as a set of **clearly bounded modules**. This is a primary design requirement, not a
nice-to-have — treat it with the same weight as the non-negotiable invariants below.
- **Modules are fractal.** The boundary rule applies at *every* level: each package is a module, and the
  directories *inside* a package (`packages/server/src/agent/`, `apps/web/src/transport/`, …) are modules
  too. A sub-module is a directory with an `index.ts` **barrel** as its only public surface; siblings
  import it **through that barrel, never its internals**. (Exception: where a barrel would defeat
  code-splitting or a library's per-file convention — e.g. `apps/web/src/panels` and `components/ui`,
  which lazy-load Monaco/shiki/xterm — imports stay per-file and the boundary is held by spec + convention.)
- **Every module has a `SPEC.md`** that states its boundary explicitly: what it owns, what it exposes
  as its public surface, and what it must *not* reach into (allowed deps and forbidden deps). The
  **dependency edges *between* sibling sub-modules live in the parent module's `SPEC.md`** (a dependency
  graph), not in each leaf — leaves declare only their own external deps + forbidden reaches.
- **Boundaries should be covered by tests** where practical — a module's public surface and its
  boundary rules are worth exercising with tests, not just relying on convention. This is a goal, not a
  hard gate: aim for coverage, but don't block on guaranteeing it everywhere.
- **The spec leads the code.** A change that moves or blurs a boundary updates the module's `SPEC.md`
  first, then the code and the tests that pin it.

## Engine: ACP agents, out of process

Built around the **[Agent Client Protocol](https://agentclientprotocol.com)**. The host is an ACP
*client*: it spawns an agent process and speaks JSON-RPC over its stdio. We never assemble the prompt
ourselves; we influence the agent only by what we feed it — context, files, the directories we point it
at, and the tools we expose to it over MCP.

**ThinkRail ships its own pi agent** (`packages/pi-agent`): a first-party ACP agent wrapping
`@earendil-works/pi-coding-agent`, bundled into the binary and launched as `thinkrail acp-pi`. The
community `pi-acp` was evaluated and rejected — it discards `session/new`'s `mcpServers`, closes every
other session on `session/new` and `session/load`, and delegates neither `fs/*` nor `terminal/*`. See
`architecture.md` Decision #14.

Out-of-process means **crash isolation**: a fatal agent or provider fault kills one supervised child, not
the host. It also means the agent's dynamic imports stopped being the host binary's problem.

> `packages/pi-agent` is the **only** package permitted to import pi, and `packages/acp` is the **only**
> package permitted to import an ACP type. The package scope for pi is `@earendil-works/*`; the
> `@mariozechner/*` scope is the **deprecated** old name — do not use it.

## Architecture (four rings)

- **Engine host** — `packages/server` (+ `packages/acp`, `packages/shared`), launched in-process by
  `apps/cli` or `apps/desktop` (Electrobun). `createServer()` = `Bun.serve` HTTP+WS +
  `AgentSessionManager` (one ACP session per tab) + handlers + persistence + **the transcript store**.
- **The wire** — `packages/contracts`: the typed, versioned protocol. Types-only, and agent-free.
- **UI client** — `apps/web`: mobile-first React, ships independently, dials a host over the wire.
- **Agents** — `packages/pi-agent` (bundled, default) and anything on the ACP registry.

V1 has two additive entrypoints: `apps/cli` boots the host in-process and opens the browser, while
`apps/desktop` packages the same host and web client in Electrobun. The `thinkrail` bin also serves the
bundled agent under the `acp-pi` subcommand. Remote/phone access (V2) is over
Tailscale; auth stays external (the app carries an `owner` field).

**V1 shape (Worktree IDE):** left = projects (git repos) → workspaces (each a `git
worktree`, own branch/cwd, under `~/.thinkrail/worktrees`); center = a tabbed area of Monaco file tabs
+ chat tabs; right = a Files tree + Changes (git diff) + terminals, all scoped to the active
worktree. The shell is built **first**, the agent connected **last**. Deferred to V2: spec-graph viewer,
PR/Checks.

## Repo layout

```
goal-and-requirements.md, architecture.md   top-level specs (repo root)
central-integration.md                      cross-module spec: JetBrains AI via Central
apps/
  cli/        V1 entrypoint: boot host + open browser;
              also `thinkrail acp-pi`, the bundled agent    (SPEC.md)
  web/        mobile-first UI client                        (SPEC.md)
  desktop/    Electrobun local-host launcher                (SPEC.md)
  website/    public landing + blog + vibecoding (Cloudflare Pages) (SPEC.md)
packages/
  server/     createServer(): Bun.serve + AgentSessionManager + transcript  (SPEC.md)
  acp/        the ACP client: spawn, negotiate, translate   (SPEC.md)
  contracts/  the wire (types-only, agent-free)             (SPEC.md)
  shared/     shellEnv (server-side only)                   (SPEC.md)
  pi-agent/   first-party ACP agent wrapping pi             (SPEC.md)
  spec-graph/ spec_* tools + skill                          (SPEC.md)
  todos/      todo_* tools                                  (SPEC.md)
  visualize/  the visualize tool                            (SPEC.md)
  pi-delegation/ portable pure-pi delegation core — pi-agent only  (SPEC.md)
  pi-subagents/  portable pure-pi Agent tools over pi-delegation   (SPEC.md)
  thinkrail-workflow/ workflow skills — pi-agent only       (SPEC.md)
```

Each capability package (`spec-graph`, `todos`, `visualize`) splits three ways: an agent-free `core/`,
agent-free tool definitions, and thin `pi/` + `mcp/` registrations over them. That split is what lets the
same tool reach the bundled pi agent natively and every other agent over MCP.

## Spec graph (how decisions are recorded)

Architecture decisions live as spec-graph nodes, dogfooding the spec layer the product is about:
- Top-level specs (`goal-and-requirements.md`, `architecture.md`) in the **repo root**.
- Each module's spec is co-located as `<module>/SPEC.md`.
- Frontmatter: `id`, `type` (goal-and-requirements | architecture-design | module-design |
  submodule-design | task-spec), `status` (draft | active | stale | done | deprecated), `title`,
  `parent` (single link), `depends-on` / `references` / `implements` (link lists), `covers` / `tags`.
- **Specs are the source of truth and are updated during implementation.** A module spec is `draft`
  until its design firms up, then `active`. Keep them honest as code lands.
- **Comments: avoid them. Near-zero is the norm.** Decisions, invariants, trade-offs, rejected
  alternatives, protocol history, bug post-mortems — all of it lives in the owning `SPEC.md` (or the
  test that pins it), never in code comments. Code carries meaning through names, types, and control
  flow. The only comments that may exist: lint/type directives (`biome-ignore` with a reason,
  `/// <reference`) and a *rare* one-line hazard note where misediting silently breaks something no
  type or test can pin — usually ending in a `see <SPEC>` pointer. A comment spanning multiple lines
  is content that belongs in a spec: move it. Never narrate code or duplicate spec prose beside it.

## Non-negotiable invariants

- **`apps/web` depends on `packages/contracts` only** — never on `server`/`shared`/`acp`. This is what
  makes the UI shippable without the host.
- **`packages/pi-agent` is the only package that may import `pi`** — value or type, any subpath. Nothing
  else: not `server`, not `contracts`, not `web`, not the capability packages.
- **`packages/acp` is the only *client*-side package that may import an ACP type.**
  `packages/pi-agent` implements the agent side and imports the agent-side types; they share only
  `packages/acp/src/meta`. Past that, `contracts` names no ACP shape, so a protocol change never reaches
  the wire or the UI. Much of the ACP surface we use is marked UNSTABLE upstream — this isolation is what
  keeps that an edit to one module.
- **One id model:** the UI tab id **is** the ACP `SessionId` the host uses for that chat. No third id.
- **The agent owns model choice, prompt assembly and cost; the host owns the transcript.** The host never
  recomputes what the agent reports — it records what it is told.
- **Streaming has three write modes:** a text/thinking *chunk* **APPENDS** (grouped by `messageId`); a
  whole *block* — image, resource, tool call — is **SET**; a `tool_call_update` **REPLACES** the fields
  it names.
- **A prompt turn is settled when `session/prompt` resolves** with its `stopReason`. ACP has no
  attempt-level boundary. Errors arrive as JSON-RPC errors and transcript entries, not a crash signal —
  wrap each call and forward to the WS client.
- **Capability-gated UI:** panels read the negotiated `ChatCapabilities` record from the wire; they never
  probe the agent and never branch on which agent is running. What an agent cannot do is **absent**, not
  disabled.
- **UI panels are layout-agnostic**; the shell arranges them (desktop multi-pane / mobile single-view).
- **Web styling = Tailwind v4 utilities mapped to the CSS-var tokens** (`@theme inline`). The `@theme`
  token families are GENERATED from JSON sources into `styles/generated/`, each carrying its own
  `@theme inline` block (Tailwind flattens imports before resolving the theme, so an imported block
  registers like an inline one): colour (`styles/colors.json` → `styles/generated/colors.css`) and
  spacing (`styles/spacing.json` → `styles/generated/spacing.css`, which **owns the Tailwind `--spacing`
  base mapping**). `apps/web/src/index.css` is the integration point — it `@import`s the generated layers
  and holds only the non-generated remainder (Preflight font defaults, chrome geometry such as
  `--spacing-panel-header-row`, animations); it does **not** own the `--spacing` mapping. Themes swap the
  token set via `[data-theme]`. Components use utilities,
  **never inline `style` objects or raw hex** — that's what keeps the UI themeable and responsive.
  **Colour has two layers and components may only name the second:** the per-theme *palette*
  (`themes/bundled/*.theme.json` → `--elevated`, `--hint`) is internal; the *semantic* tokens
  (`styles/colors.json` → `bg-container-elevated-bg`, `text-feedback-warning`) are the surface. Tints
  come from a four-step alpha scale as tokens, never Tailwind's `/40` modifier. `styles/COLOR.md` is
  the system, `styles/colorUsage.test.ts` the gate — Tailwind drops an unknown utility *silently*, so
  a token that isn't published renders as nothing.
- **Icons: `@remixicon/react` (Remix Icon; outline `Line` by default, solid `Fill` when the item is active/selected) only. UI primitives: shadcn/ui** (Radix), copied into
  `apps/web/src/components/ui/` (we own them) and themed with our token utilities — *not* shadcn's
  default palette. `cn()` lives in `apps/web/src/lib/utils.ts`.
- The transport's **host endpoint is a parameter** (default same-origin); `server.welcome` carries
  ThinkRail's protocol version so an independently-shipped UI can detect host drift, plus the ACP version
  negotiated with the active agent so a capability gap can be attributed to the agent.

## Chat UI (the conversation renderers)

The agent conversation is rendered by **hand-rolled React primitives** in `apps/web/src/chat/`. They
render **ThinkRail's own transcript model** (`packages/contracts`), never an ACP shape — `packages/acp`
translates protocol updates into it, and the UI has no idea what protocol the host speaks. That is what
makes the renderers reusable and the UNSTABLE half of ACP survivable (extraction-ready as a future
`packages/chat-ui`).
- **Presentational renderers are props-driven** (no store/transport) so they stay reusable; `ChatView` is
  the only app-integration piece (wires store + transport). Theme **only via token utilities** so the
  primitives wear any theme.
- **Adding a tool = two decoupled sides, joined by tool name:** the **capability** lives in a capability
  package (`spec-graph`, `todos`, `visualize`) as an agent-free tool definition, registered natively by
  `packages/pi-agent` and exposed to every other agent over MCP; the **presentation** is a UI renderer
  registered via **`registerToolRenderer("<name>", …)`** (`chat/toolRegistry`). The wire carries
  `toolName` as a **required** field — the host resolves it, synthesising `acp:<kind>` when the agent
  reports no name — so the UI reads one field and only consults `title` when `isSyntheticToolName()`.
  Unregistered tools fall back to `DefaultToolRenderer`. Interactive tools route through ACP elicitation.
- **Capability-driven chrome.** The composer, header and stats strip read `ChatCapabilities`. Absent
  capabilities render nothing; a badge names the active agent so the difference is explained.
- Full module spec: `apps/web/src/chat/SPEC.md`.

## Verification (run for every app-affecting change)

Every change that touches the app is verified by the **complete e2e suite once before it is considered
done**. During implementation, iterate with the affected spec
(`bun run e2e -- e2e/<feature>.spec.ts`) or `bun run e2e -- --last-failed`; do not rerun the full gate
after every edit.

`bun run e2e` is **fully self-contained and machine-adaptive**: it builds the web app once, then runs the
no-agent tests across isolated Playwright shard processes (automatic count = half the available CPUs,
clamped to 1–8). Every lane owns one serial worker + host and its own per-worktree-qualified ports, state,
HOME, pi-agent dir, fixture repo, and control files; reports merge into one result. Override with
`THINKRAIL_E2E_SHARDS=N` or `--shards=N` (1–16); use `bun run e2e:serial` for one-lane debugging. The
paths derive in `e2e/fixtures/paths.ts`, never touch `~/.thinkrail`, and parallel runs from different
worktrees never collide. Two complete invocations in the same worktree remain sequential. Focused
`e2e:full` runs preflight both modes and skips a mode with no selected tests; selecting nothing fails, while
an argument-free run and `--list` retain both phases. Cancellation in the no-agent, agent, and full runners
signals their complete child trees (POSIX snapshot; Windows tree-aware termination), then force-kills
survivors after a bounded grace; this does not describe the separate binary or desktop artifact runners. Each
lane seeds fixtures (`globalSetup`), drives the real web UI, then tears its host down and cleans up
(`globalTeardown`). Tests live in `e2e/` and
assert via `data-testid` / `data-status` hooks. Design: `e2e/SPEC.md`. The same suite also has
packaged CLI-binary and Electrobun-desktop host modes.

**Two kinds of agent coverage: a scripted fake, and the real thing.**

`e2e/fixtures/fake-agent/` is a scripted ACP agent — a small program that speaks the protocol over stdio
and replies on script. Because the agent is a separate process now, it can be faked cleanly, so the
deterministic, offline, credential-free suite covers the paths that matter most under ACP: streaming and
tool-call rendering, capability negotiation, elicitation, MCP tool delivery, and the failure modes that
only exist out-of-process — agent crash mid-turn, missing binary, refused spawn, absent capability,
protocol-version mismatch. It runs in the default `bun run e2e` gate.

Specs that drive the **real bundled pi agent** stay tagged `@agent` (Playwright `{ tag: "@agent" }`) and
still run against a real provider — the fake proves the client, only the real agent proves the round
trip. The pi agent runs against an **isolated pi agent dir** (`PI_CODING_AGENT_DIR` → a throwaway dir
under the e2e data dir; `globalSetup` copies the user's pi auth config (`auth.json` **+ `models.json`** —
auth lives in both: OAuth providers in `auth.json`, apiKey providers in `models.json`) so a real provider
works, and seeds a `settings.json` pinning a **deterministic default model** — override with
`THINKRAIL_E2E_MODEL=<provider>/<modelId>`) — so a test's model/thinking selection persists *there*,
**never the user's real `~/.pi/agent`**. (Corollary: don't let an `@agent` test *select* a model — it
would pin a default mid-run.)

Select suites by marker: `bun run e2e` runs the **no-agent** suite (`--grep-invert @agent`) — including
every fake-agent spec — fast, no auth, run anytime; `bun run e2e:full` runs everything; `bun run
e2e:agent` runs only the `@agent` specs (which need `pi` authenticated + more time).
**`bun run e2e:binary`** (after `bun run build:binary`) runs the no-agent suite against the **compiled
single-file binary** instead of the dev host (skipping the `@dev-seam` fake-login specs — those fakes
live only in the dev boot): the gate for the regression class that only exists inside the artifact —
now chiefly that `thinkrail acp-pi` spawns and pi's dynamic imports resolve inside the bundled agent —
alongside the targeted probes in `smoke:binary`.

**A third kind of coverage, below the browser: the protocol itself.** `packages/acp/src/testing`
holds a committed corpus of JSON-RPC frames and validates every one against the SDK's own
`schema/schema.json` — an artifact we did not author, so an SDK bump moves it under us. Each frame
is checked twice, against its direction's union and against the definition its method resolves to,
because the unions alone accept almost anything (`ExtNotification`'s schema is the empty object).
The corpus is then asserted to cover **exactly** the variant set that schema declares for every
vocabulary ThinkRail translates — set equality, so a variant added upstream and a corpus entry the
protocol no longer declares both fail — and `translate/exhaustiveness.test.ts` compares each
translator's table against the same schema, which is the only gate that can exist for the two unions
ACP declares open. Capture a real session by setting `THINKRAIL_ACP_RECORD_DIR=<dir>`: the recorder
is a spawner decorator, inert until that variable is set, and replay drives a recording back through
the assembler with no process at all — record → replay is asserted to produce the same `ChatEvent`s
the live connection published. It all runs in `bun test` inside `packages/acp`; design:
`packages/acp/src/testing/SPEC.md`.

**The module boundaries are a gate, not a convention.** `bun run check:arch` reads every `import` /
`export` / `require` / `import()` in `apps/*` and `packages/*` through the TypeScript parser — a
specifier inside a comment or a string is not an import — and fails with the file, the line and the
specifier when one crosses a boundary the specs forbid: `packages/contracts` imports nothing,
`packages/acp/src/meta` stays dependency-free, `apps/web` sees only the wire, `packages/acp` never
imports the host, the ACP SDK stops at the five client-side sub-modules of `packages/acp` plus
`packages/pi-agent` on the agent side, and pi stops at `packages/pi-agent` plus the portable pi
extensions. The host's remaining pi importers are named exemptions that **expire on their own** —
when nothing under a listed path imports pi any more the gate fails and names the entry to delete,
so the `packages/pi-agent` move cannot leave dead exemptions behind. The rule table lives in
`scripts/check-architecture.ts` and is covered by `bun test ./scripts`; **when a boundary is meant
to move, the owning `SPEC.md` changes first, then that table.**

Separate from the browser suite: `bun run test:workflows` — the headless **workflow-skill suite**
(`e2e/workflows/`, own Playwright config, no browser/webServer; drives the real bundled pi agent
through the workflow skills). On-demand only: needs pi auth and spends real provider tokens — never a
commit/CI gate. Design: `e2e/workflows/SPEC.md`.

Fast gates (also the husky pre-commit): `bun run check:deps` (dependency pins) +
`bun run check:boundaries` (workspace dependency/import edges) + `bun run check:arch` (the ACP/pi import
invariants, above) + `bun run check:seams` (the pi binary-seam canary, now scoped to
`packages/pi-agent`'s bundle — fails when a pi bump adds a bundler-opaque dynamic import that
`registerBundledRuntime` doesn't statically register) + `bun run lint` (biome) + `bun run typecheck`.
Unit tests: `bun run test` (bun test per package, then `bun test ./scripts` for the gates themselves).
One-time setup for a fresh machine: `bunx playwright install chromium`.

## Handoff hygiene (before any commit, PR, or "done" summary)

Green gates are necessary, not sufficient — they can't see duplication, suppressions, or leftovers.
Before committing, opening/updating a PR, or declaring work done, re-read the full diff
(`git diff origin/main...HEAD` + working tree) as a reviewer would, and enforce:

- **No silent suppressions.** Never add `biome-ignore` / `@ts-expect-error` / `@ts-ignore` /
  `eslint-disable` / `as any` to make a gate pass. A lint/type error is a design signal: first ask
  whether the state, dependency, or structure it flags should exist at all — prefer deleting the cause
  over guarding it. If a suppression still seems genuinely right, stop and get user sign-off first; an
  unrequested suppression must never be discovered in review. Audit before handoff:
  `git diff origin/main...HEAD -U0 | rg '^\+.*(biome-ignore|eslint-disable|@ts-ignore|@ts-expect-error|as any)'`
  → must come back empty.
- **No comment creep.** New comments in the diff are suspect by default (see the near-zero rule under
  *Spec graph*): a rationale paragraph added as a comment gets moved to the owning `SPEC.md` before
  handoff. Audit: `git diff origin/main...HEAD -U0 | rg '^\+\s*(//|/\*|\*)'` → every hit is a lint
  directive or a one-line hazard note, nothing else.
- **No duplicated derivations.** The same nontrivial expression/lookup landing in 2+ places means
  centralize it first. Web specifics: derived state belongs in store selectors
  (`apps/web/src/store/selectors.ts`), components never inline multi-step derivations from store state;
  store writes that always travel together are one atomic store action, not two calls at each call site.
- **Refactor sweep.** When a change replaces a pattern or state model, `rg` the repo for the old
  pattern and migrate every occurrence — or name the survivors and why in the handoff. Never leave call
  sites half-migrated.
- **End analyses with an offer.** When the user questions your recent work and your analysis concludes a
  change is warranted, finish with the concrete change + "apply?" (or just apply it if it's within the
  approved scope) — never with prose that makes the user say "do the cleanup then please".
- **UI-visible changes:** offer before/after screenshots alongside the PR without being asked.

## Stack

Bun + Turbo monorepo · TypeScript (strict) · React 19 + Zustand + Tailwind v4 (web) · ACP over stdio
via `@agentclientprotocol/sdk` · bundled pi agent via `@earendil-works/pi-coding-agent` (Node ≥ 22.19),
reachable only from `packages/pi-agent`. On-disk app state under `~/.thinkrail`.

- **Dependencies pin exact versions — no ranges** (`^`/`~`/`.x`/`*`). Cross-cutting deps are pinned once in
  the root `workspaces.catalog` and referenced via `catalog:`. Enforced by `bun run check:deps`
  (`scripts/check-catalog.ts`, in pre-commit + CI); `peerDependencies` + local protocols are exempt. See
  `architecture.md` Decision #10 for the why.
