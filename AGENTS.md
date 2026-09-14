# ThinkRail

The agentic IDE that gets better every time you use it, built around the `pi` coding agent. The app is
a thin host that runs `pi` and bridges it to a rich UI; `pi` owns models, skills, compaction, cost, and
session state.

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

## Engine: `pi` only, in-process

- Every package and meaningful directory-level sub-module has a `SPEC.md` stating its responsibility,
  public surface, allowed dependencies, and forbidden reaches.
- A sub-module exposes an `index.ts` barrel as its only public surface; siblings import through the
  barrel, never internals. Per-file imports remain only where a barrel would defeat code-splitting or a
  library convention, such as `apps/web/src/panels` and `packages/ui`.
- Dependency edges between sibling sub-modules live in the parent module's `SPEC.md`, not each leaf.
- A change that moves or blurs a boundary updates the owning spec first. Cover public surfaces and
  boundary rules with tests where practical, but do not manufacture coverage for a localized change.

Tradeoff: in-process means **no crash isolation** — a fatal agent/provider fault takes the whole host
down. Sessions still run concurrently (cooperative on one event loop); the subprocess RPC mode is the
only alternative if fault isolation ever becomes worth the complexity.

> The package scope is `@earendil-works/*`. The `@mariozechner/*` scope is the **deprecated** old name —
> do not use it.

## Architecture (three rings)

- `apps/web` depends on `contracts`, `ui`, `extension-api/web`, and `thinkrail-extensions/*/web` only,
  never `server` or `shared`.
- Never value-import `pi` into browser-bundled code. Import types only from the `pi-ai` /
  `pi-agent-core` package roots; `@earendil-works/pi-coding-agent` is server-only.
- One id model: UI tab id versus `session.sessionId`; there is no separate pi UUID.
- `pi` owns state. The host exposes what pi reports rather than recomputing cost, stats, or state.
- Streaming semantics: `text_delta` / `thinking_delta` append;
  `tool_execution_update.partialResult` replaces.
- `prompt()` throws while a session is streaming; use `steer()` / `followUp()`. Forward errors through
  the event stream and thrown method result rather than treating them as a crash signal.
- Automatic work ends at `agent_settled`, never `agent_end`; retries, compaction, recovery, or queued
  continuations may follow an attempt-level `agent_end`.
- UI panels are layout-agnostic; the shell arranges them.
- The transport host endpoint is a parameter, defaulting to same-origin; `server.welcome` carries the
  protocol version.

- **The wire** — `packages/contracts`: the typed, versioned protocol. Types-only.
- **UI client** — `apps/web`: mobile-first React, ships independently, dials a host over the wire.

For web UI work, read `apps/web/SPEC.md` and the owning sub-module spec. Styling uses Tailwind v4
utilities mapped to generated semantic CSS-var tokens: never inline style objects, raw hex, internal
palette names, or unknown token utilities. Read `apps/web/src/styles/COLOR.md` for color work and
`apps/web/src/styles/SPACING.md` for spacing work. Use `@remixicon/react` icons (Line by default, Fill
when active) and owned shadcn/Radix primitives from `@thinkrail/ui/<primitive>`; `cn()` lives in
`@thinkrail/ui/utils`. These rules also apply to `packages/ui` and extension web halves.

**V1 shape (Worktree IDE):** left = projects (git repos) → workspaces (each a `git
worktree`, own branch/cwd, under `~/.thinkrail/worktrees`); center = a tabbed area of Monaco file tabs
+ chat tabs; right = a Files tree + Changes (git diff) + terminals, all scoped to the active
worktree. The shell is built **first**, `pi` connected **last**. Deferred to V2: spec-graph viewer,
PR/Checks.

## Repo layout

```
goal-and-requirements.md, architecture.md   top-level specs (repo root)
central-integration.md                      cross-module spec: JetBrains AI via Central
apps/
  cli/        V1 entrypoint: boot host + open browser   (SPEC.md)
  web/        mobile-first UI client                    (SPEC.md)
  desktop/    Electrobun local-host launcher             (SPEC.md)

  website/    public landing + blog + vibecoding (Cloudflare Pages) (SPEC.md)
packages/
  server/     createServer(): Bun.serve + AgentSessionManager  (SPEC.md)
  contracts/  the wire (types-only)                     (SPEC.md)
  shared/     shellEnv (server-side only)               (SPEC.md)
  spec-graph/ portable pi extension: spec_* tools + skill (SPEC.md)
  plugin-api/ the plugin contract: manifest, host/web contexts (SPEC.md)
  plugin-ui/  shared plugin UI kit: primitives, markdown, editor (SPEC.md)
  plugin-spec-dialect/ builtin plugin: spec-graph read + Specs panel (SPEC.md)
  plugin-blueprint/ builtin plugin: interactive-spec format, author, reactor (SPEC.md)
  pi-delegation/ portable pure-pi delegation core: child sessions from sessions (SPEC.md)
  pi-subagents/  portable pure-pi extension: Agent tools over pi-delegation (SPEC.md)
  plugin-claude-code/ builtin plugin: Claude Code config, IDE bridge, terminal status (SPEC.md)
  plugin-discord/ builtin plugin: Discord Rich Presence over local IPC (SPEC.md)
  plugin-branch-graph/ builtin plugin: the project's branch graph side tool (SPEC.md)
  plugin-visualize/ builtin plugin: terminal agent's live drawing surface (SPEC.md)
```

## Spec graph (how decisions are recorded)

- Iterate with the smallest relevant unit or focused E2E target.
- For shipped app behavior or integration changes, run the complete no-agent browser suite
  (`bun run e2e`) once after the combined implementation and before final handoff or PR — not once per
  TODO item or commit.
- When the change touches real agent behavior, also run the focused live specs that cover it, e.g.
  `bun run e2e:full e2e/agent-naming.live.spec.ts`; that needs no approval. Ask the user before running
  the complete `bun run e2e:full` suite: it spends real provider tokens and much more time.
- Documentation/spec-only changes and test-harness-only changes use targeted checks unless they can
  affect the shipped runtime.
- Fast gates: `bun run check:deps`, `bun run check:boundaries`, `bun run check:seams`, `bun run lint`,
  and `bun run typecheck`. Unit tests are `bun run test`; `bun run check:spec-surface` validates enrolled
  spec/barrel public surfaces.
- `bun run test:workflows` is on-demand: it uses real provider tokens and is not a commit/CI gate.
- Binary and desktop artifact modes have separate gates; use them when changing those artifacts.

## Non-negotiable invariants

- **`apps/web` depends on `packages/contracts`, `packages/plugin-api` (the `/web` entry and root types),
  and `packages/plugin-ui`, plus a builtin plugin package's `./manifest` and `./web` — never on
  `server`/`shared`, and never a plugin's `host` half.** This is what makes the UI shippable without the
  host. An external plugin's web half arrives over the wire instead of at build time.
- **Never *value*-import `pi` in browser-bundled code; import types only, from the `pi-ai` /
  `pi-agent-core` package roots** (`verbatimModuleSyntax` erases type-only imports, so no runtime reaches
  the bundle). `@earendil-works/pi-coding-agent` is server-only and never reaches `contracts`/`web` (it
  pulls `node:fs` + provider SDKs). `pi-agent-core` + `pi-ai` are type-only devDeps of `contracts`.
- **One id model:** the UI tab id vs `session.sessionId` (the `AgentSession` id). No separate pi UUID.
- **`pi` owns state**; the host is a thin bridge and does not recompute what `pi` reports (cost, stats).
- **Streaming:** `text_delta` / `thinking_delta` **APPEND**; `tool_execution_update.partialResult`
  **REPLACE**.
- **`prompt()` throws while a session is streaming** → call `steer()` / `followUp()`. Errors arrive via
  the event stream + thrown methods, not a crash signal — wrap each call and forward to the WS client.
- **Automatic work ends at `agent_settled`, never `agent_end`.** `agent_end` is attempt-level and may be
  followed by provider retry, compaction/recovery, or a queued continuation even when `willRetry` is false.
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
- **Icons: `@remixicon/react` (Remix Icon; outline `Line` by default, solid `Fill` when the item is active/selected) for everything the UI *does*.** What a *file* **is** is the one exception: file-type
  glyphs come from the builtin `packages/plugin-file-icons` plugin's **material-icon-theme** (MIT) set,
  recoloured to `currentColor` at build time and served through the `fileIcon` core slot; core's
  `components/FileTypeIcon` falls back to a plain Remix glyph when that plugin is off. Remix has no
  vocabulary for `.kt` vs `.tsx` vs `Dockerfile`, and inventing one per language is not a UI kit's job.
  **UI primitives: shadcn/ui** (Radix), copied into
  `apps/web/src/components/ui/` (we own them) and themed with our token utilities — *not* shadcn's
  default palette. `cn()` lives in `apps/web/src/lib/utils.ts`.
- The transport's **host endpoint is a parameter** (default same-origin); `server.welcome` carries a
  protocol version so an independently-shipped UI can detect host drift.

## Chat UI (the conversation renderers)

- Before a local handoff, review the task-scoped working tree and commits. Before opening or updating a
  PR, review the full branch diff against its base plus the working tree.
- For nontrivial implementation, do a subtraction pass: remove avoidable abstractions, state owners,
  dependencies, compatibility layers, and fallbacks. Report material removals and justify layers that
  remain; do not add ceremony for a localized edit.
- Never add `biome-ignore`, `@ts-expect-error`, `@ts-ignore`, `eslint-disable`, or `as any` merely to make
  a gate pass. Treat the error as a design signal. If a suppression is genuinely required, get explicit
  user approval first.
- Audit newly added comments and suppressions in the same diff range being reviewed. Do not let prior,
  unrelated branch history contaminate a task-local handoff.
- Centralize duplicated nontrivial derivations. In the web app, derived store state belongs in
  selectors and writes that always travel together belong in one atomic action.
- When replacing a pattern or state model, search for every old occurrence and migrate it, or name the
  intentional survivors.
- `README.md` is the user-facing front page. For a change that adds, removes, or renames a user-visible
  capability, or alters installation or analytics behavior, review its claims and update the affected
  ones in the same change; refresh a screenshot under `.github/readme-assets/` when the UI it depicts
  changes materially.
- Apply safe cleanup that is inside the approved scope. Ask only for destructive, out-of-scope, or
  product-level decisions.
- Use the `shipping-a-pr` skill for PR lifecycle work, including screenshot expectations and PR
  templates. When creating an issue programmatically, reproduce the selected issue template and pass
  its frontmatter labels.

## Stack

Bun + Turbo monorepo · TypeScript (strict) · React 19 + Zustand + Tailwind v4 (web) · in-process `pi`
via `@earendil-works/pi-coding-agent` (Node ≥ 22.19). On-disk app state under `~/.thinkrail`.

- **Dependencies pin exact versions — no ranges** (`^`/`~`/`.x`/`*`). Cross-cutting deps are pinned once in
  the root `workspaces.catalog` and referenced via `catalog:`. Enforced by `bun run check:deps`
  (`scripts/check-catalog.ts`, in pre-commit + CI); `peerDependencies` + local protocols are exempt. See
  `architecture.md` Decision #10 for the why.
