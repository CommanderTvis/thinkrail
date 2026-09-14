# ThinkRail

A ThinkRail-branded desktop-and-mobile client for the `pi` coding agent. The app is a thin host that
runs `pi` and bridges it to a rich UI; `pi` owns models, skills, compaction, cost, and session state.

## Fork workflow

This is CommanderTvis's fork of JetBrains/thinkrail (`upstream`). Upstream is a client for `pi`; the fork
makes ThinkRail a workbench for more than one agent (Claude Code in the terminal, through the plugin API)
while keeping every commit that upstream could take separate from the ones it could not. Its default branch,
`claude-code-integration-plugin-api`, is a rebased chain on `upstream/main` in three parts, in this order:

1. **General improvements** — one commit per change that applies to upstream directly, each the unit of
   a future upstream PR. Original subject, body and `Fixes JetBrains/thinkrail#<n>` trailer where an issue
   exists.
2. **The plugin API** — one commit: `packages/plugin-api`, `packages/plugin-ui`, the server loader, the web
   registry, no plugins.
3. **One commit per builtin plugin**, so each can be extracted to its own repository: spec-dialect,
   blueprint, claude-code, discord, pdf-preview, branch-graph, visualize, file-icons, codex.

Fork-only files (this README, this section) sit in one commit at the top.

- **Amend, don't append.** A fix to something that already exists goes into the commit that owns it:
  `git commit --fixup=<sha>` then `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash upstream/main`,
  and `git push --force-with-lease`. A change that touches two parts is two fixups. The branch is
  force-pushed aggressively; checkouts update with `git fetch && git reset --hard origin/<branch>`.
- **New commits only for new things:** a new fix or feature for upstream (part 1, placed after the
  commits it depends on), a new plugin (part 3), or a new core capability of the API (part 2 only if the
  API commit would otherwise be incomplete without it; a capability a plugin introduced stays in that
  plugin's commit until it is generalised).
- **A part-1 commit is inserted into part 1, never appended at the tip.** The tip is the fork-only
  commit; a new upstream-applicable fix or feature landing after it (or after the plugin commits) is
  a placement bug, not a valid new commit — rebase it to sit with the other part-1 commits, before the
  plugin API commit. One user-facing change is one commit: don't leave a feature and its own follow-up
  fixes as separate commits once work on it is done — amend/squash them into that single commit
  before moving on, per "amend, don't append" above.
- **Every commit is green on its own:** `bun run typecheck`, `bun run lint` and `bun run test` pass at
  each step, and the lockfile matches that step's manifests (`bun install --frozen-lockfile`). Test
  files land with the code they test, never ahead of it.
- **Upstream sync** is a rebase of the whole chain onto `upstream/main`; conflicts are resolved in the
  commit that owns the file, and the final tree is compared against the pre-rebase tree before pushing.
- **`electrobun prepare` is a single machine-wide lock, not a per-project one.** `bun scripts/prepare-devkit.ts`
  (and anything that runs it: `apps/desktop`'s own `typecheck`, therefore the repo's `typecheck` gate and the
  pre-commit hook) hangs indefinitely, with no output, while any `electrobun dev`/`bun run desktop:dev`
  session is running anywhere on the machine — `hutch-engine` serializes every `prepare` behind a live
  `dev`'s hold on the engine. This reproduces identically from a completely separate `git worktree` in
  `/tmp`; the lock is not scoped to the project path, so an isolated disposable checkout does **not** avoid
  it. Diagnosis: `hutch-engine status` (fast, unaffected) lists every registered project and its lock state.
  Workaround: either stop the live `dev` session first, or skip that one step —
  `CI=true bunx turbo run typecheck --filter='!@thinkrail/desktop'` plus `git commit --no-verify` — and
  verify `apps/desktop` separately once a `dev` session is not running. Never `rm -rf .hutch` to "fix" a
  hang: there is no tracked backup, and regenerating it hits the same lock.
- **A single `git commit` invocation runs the full hook once.** If a commit hangs on the desktop step,
  killing only *your own* spawned process tree (`prepare-devkit.ts` / `electrobun prepare`, found by
  their start time) is safe; never touch a `dev` process you did not start — it is very likely the
  live app someone is using to look at the result.
- **Sending upstream:** a PR is one part-1 commit cherry-picked onto a branch from `upstream/main`; its
  message is the commit message. Once merged, the rebase drops the commit.

### The fork's commits, by title

The chain as of this writing, in order; titles rather than hashes because the hashes change on every
rebase. Update this list when a commit is added, retitled or dropped.

Part 1, general improvements, each a candidate upstream PR:

- Reveal a file in the file manager, from our own menu
- Open a plain folder as a project, with no git required
- web: our own tab tooltips, and they stop blocking what they cover
- Send an editor selection into a pi chat
- Where a tab can go, drawn instead of listed
- The light theme's diff canvas stops reading as disabled
- Previewing a file before you keep it is a setting
- The desktop window comes back to the port it had, and with it your tabs
- tests: a fixture open survives a neighbour's pick and a loaded machine
- Frontmatter edits like Obsidian properties, above the rendered view
- The spec tools reach any agent in a ThinkRail terminal, over MCP
- Panes a resource carries: embedded, never a tab of their own
- A terminal whose pty inherited a stale utmpx record no longer runs as the wrong user
- The outline moves to the pane's edge and drives both preview and source
- A terminal frozen by a drain event the OS never delivered thaws on its own
- On the desktop, the host is this computer, and the copy stops calling it "the host"
- A file in the tree can be dragged to where it is wanted
- feat(web): put the target choice above the Start work header
- An issue number in a comment stops being painted as a colour
- A repository URL becomes a project, cloned into a folder you choose
- The desktop's right-click menu stops offering Look Up, Fonts, and Services
- A file in the tree can be deleted, into the trash, after asking
- A diff too narrow for two columns opens inline until you say otherwise
- Cmd+F finds text in every preview, not only inside the editor
- Typechecking the desktop stops waiting on a dev host that is running
- A diagram inline in a document stops at a height you can see past
- Search the whole workspace from one popup
- The rendered markdown diff gets the outline and the properties block
- A workbench frame belongs to the project it was arranged in
- A selection you can see in the dark theme
- The projects rail's plus says what it does
- A spec's own frontmatter is a properties table, not a raw block
- An inline diagram zooms like the fullscreen one, and pans inside its box
- chore: bump TypeScript to 7.0.2 and migrate off the legacy compiler API
- A spec is titled by its frontmatter, and its [[links]] go somewhere
- The branch in the topbar opens the project's branches
- A project with no specs opens its rail on Files
- A terminal nobody is looking at stops rendering
- The bottom row's controls clear the window's rounded corner
- A code font you choose, with its ligatures
- Settings answer to Command+, on macOS
- The topbar says what "from main" means
- A large markdown preview stops re-doing its own work
- A selection reaches the document, not the chrome around it
- Tests, fixtures and spec text the fork's changes left behind
- The CLI waits a beat for a tab that is already open before opening another
- Vertical tabs can live under their workspace in Projects
- A dirty worktree can be force-removed before its branch
- Branch pickers show every remote, collapsibly, and a click can switch or start a workspace
- The Welcome provider warning recognizes connected JetBrains AI
- JetBrains AI access source switching, for accounts with more than one org
- Hidden models you can filter out in Settings and the model picker
- A tooltip when a model name truncates in the model selector
- Questionnaires superseded by later assistant activity clear the waiting status
- Attached images in chat draft persist across tab switches
- An open file says when its file is deleted on disk
- A file or folder can be created, or renamed, from the Files tree
- Remove the CLAUDE.md alias of AGENTS.md
- Terminals start clean after a host restart
- OpenAI models carry their provider mark
- Chat tabs carry the Pi mark
- A live terminal reattach restores full-screen input modes
- Chats survive a provider switch when their saved model is unavailable
- A project's absolute path can be copied from its context menu
- A worktree made in ThinkRail's folder shows up as a workspace
- A terminal agent names its workspace with set_title, over MCP
- perf(web): enable the native React Compiler
- Restoring the latest Pi chat in every workspace is a setting
- Recents stops listing project folders that no longer exist

Part 2, the plugin API, and the change that builds on it:

- Plugin API: the contract, the host loader, the web registry, and the UI kit
- A review comment can be sent to an agent in a terminal, not just a chat session (rides on the plugin API's terminal-agent surface)

Part 3, one builtin plugin per commit:

- The spec dialect is the first builtin plugin (spec-graph read, Specs panel, `spec_*` renderers)
- Blueprint is a builtin plugin built on the spec dialect (interactive-spec format, author, reactor)
- Claude Code integration is a builtin plugin (config pane, IDE bridge, hook status, launcher, terminal facts)
- Discord Rich Presence is a builtin plugin (presence over local IPC)
- The PDF preview is a builtin plugin (PDF file viewer, web only)
- The branch graph is a builtin plugin (the project's branch graph side tool)
- The terminal visualization is a builtin plugin (the terminal agent's live drawing surface)
- File-type icons are a builtin plugin (material-icon-theme glyphs, web only)
- OpenAI Codex is a builtin plugin (config, launcher, hook status, MCP wiring)

Fork-only, one commit at the top: The fork describes itself: what it adds, how to run it, how its history moves (README, this file's fork sections).

## Read context proportionally

- Use `goal-and-requirements.md` for the product's goal, principles, capabilities, and non-goals.
- Use `architecture.md` for system topology, cross-module decisions, and repo-wide invariants.
- Read the owning `SPEC.md` when work is governed by or may alter a module boundary, contract,
  invariant, documented behavior, or architecture decision.
- Localized work does not require unrelated specs or a full repository map.

## Module structure and boundaries

Clear, fractal module boundaries are a top-priority requirement:

- Every package and meaningful directory-level sub-module has a `SPEC.md` stating its responsibility,
  public surface, allowed dependencies, and forbidden reaches.
- A sub-module exposes an `index.ts` barrel as its only public surface; siblings import through the
  barrel, never internals. Per-file imports remain only where a barrel would defeat code-splitting or a
  library convention, such as `apps/web/src/panels` and `components/ui`.
- Dependency edges between sibling sub-modules live in the parent module's `SPEC.md`, not each leaf.
- A change that moves or blurs a boundary updates the owning spec first. Cover public surfaces and
  boundary rules with tests where practical, but do not manufacture coverage for a localized change.

## Engine and architecture

- Run `pi` in-process through `@earendil-works/pi-coding-agent` (`createAgentSession`), never as a
  subprocess and never through a second agent runtime. Fatal provider/agent faults can take down the
  host; that lack of crash isolation is accepted.
- The three rings are engine host (`packages/server` + `packages/shared`), typed wire
  (`packages/contracts`), and independently shippable UI (`apps/web`). `apps/cli` and `apps/desktop`
  are thin launchers over the same host.
- Use only the `@earendil-works/*` package scope. `@mariozechner/*` is deprecated.

## Repo-wide invariants

- `apps/web` depends on `packages/contracts` only, never `server` or `shared`.
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

### Web UI context

For web UI work, read `apps/web/SPEC.md` and the owning sub-module spec. Styling uses Tailwind v4
utilities mapped to generated semantic CSS-var tokens: never inline style objects, raw hex, internal
palette names, or unknown token utilities. Read `apps/web/src/styles/COLOR.md` for color work and
`apps/web/src/styles/SPACING.md` for spacing work. Use `@remixicon/react` icons (Line by default, Fill
when active) and owned shadcn/Radix primitives from `apps/web/src/components/ui/`; `cn()` lives in
`apps/web/src/lib/utils.ts`.

For conversation rendering or tool presentation, read `apps/web/src/chat/SPEC.md`. Presentational
renderers remain props-driven; only `ChatView` integrates store and transport. A server capability and
its UI renderer are joined by tool name through `registerToolRenderer`; unregistered tools use the
default renderer.

## Specs and comments

Specs are the durable home for intent, decisions, invariants, trade-offs, and post-mortems. Keep them
concise and avoid restating code or another spec. Comments are near-zero: lint/type directives and a
rare one-line hazard note are acceptable; rationale and narrative belong in the owning spec.

## Verification

Local tests use disposable fixtures and have no production access. Run affected tests, fix failures
caused by the requested change, and rerun them without asking for approval at each step.

- Iterate with the smallest relevant unit or focused E2E target.
- For shipped app behavior or integration changes, run the complete browser E2E suite once after the
  combined implementation and before final handoff or PR — not once per TODO item or commit. Use
  `bun run e2e:full` when the change touches real agent behavior; otherwise use `bun run e2e`.
- Documentation/spec-only changes and test-harness-only changes use targeted checks unless they can
  affect the shipped runtime.
- Fast gates: `bun run check:deps`, `bun run check:boundaries`, `bun run check:seams`, `bun run lint`,
  and `bun run typecheck`. Unit tests are `bun run test`; `bun run check:spec-surface` validates enrolled
  spec/barrel public surfaces.
- `bun run test:workflows` is on-demand: it uses real provider tokens and is not a commit/CI gate.
- Binary and desktop artifact modes have separate gates; use them when changing those artifacts.

All runner modes, isolation guarantees, credential handling, cancellation behavior, and debugging
commands live in `e2e/SPEC.md`; workflow harness details live in `e2e/workflows/SPEC.md`.

## Handoff hygiene

Green gates are necessary but not sufficient:

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
- Apply safe cleanup that is inside the approved scope. Ask only for destructive, out-of-scope, or
  product-level decisions.
- Use the `shipping-a-pr` skill for PR lifecycle work, including screenshot expectations and PR
  templates. When creating an issue programmatically, reproduce the selected issue template and pass
  its frontmatter labels.

## Stack

Bun + Turbo monorepo · TypeScript strict · React 19 + Zustand + Tailwind v4 · in-process `pi`
(Node >= 22.19). App state lives under `~/.thinkrail`.

Dependencies pin exact versions. Cross-cutting dependencies are pinned once in the root
`workspaces.catalog` and referenced through `catalog:`; peer dependencies and local protocols are the
only exemptions. `architecture.md` Decision #10 owns the rationale.
