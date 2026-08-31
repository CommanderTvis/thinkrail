---
id: goal-and-requirements
type: goal-and-requirements
status: active
title: ThinkRail — product goal and scope
covers: [product-goal, v1-scope, v2-scope, engine-decision, agent-portability]
tags: [product, scope]
---

## Goal

ThinkRail is a ThinkRail-branded desktop-and-mobile client for **ACP coding agents**. The product is a
thin host that bridges an agent to a rich UI and, over time, layers spec-driven workflows on top.

## Engine

**Any agent that speaks the [Agent Client Protocol](https://agentclientprotocol.com).** ThinkRail is an
ACP *client*: it launches an agent as a separate process and talks JSON-RPC over stdio. The agent owns
the model registry, the system prompt, its own skills/extensions, compaction and cost. Every feature
influences the agent by what we **feed** it — prompt context, files, the tools we expose over MCP, the
directories we point it at — never by assembling the prompt ourselves.

**ThinkRail ships its own first-party pi agent** (`packages/pi-agent`): an ACP agent wrapping
`@earendil-works/pi-coding-agent`, bundled into the binary and launched as a subcommand. It is the
default agent and the only place in the repo that knows pi exists. Owning it is what lets ThinkRail's
tools, its questionnaire, its skills trust model and pi's retry/compaction signals survive a protocol
that has no vocabulary for them.

Two consequences are deliberate:

- **Agents are processes, so a fatal agent fault no longer takes the host down.** This reverses the
  in-process tradeoff ThinkRail carried through V1.
- **Feature parity is per-agent, and the UI says so.** A capability record negotiated at connect drives
  which controls exist for a given chat. What an agent cannot do is *absent*, never broken.

## V1 — Worktree IDE + cheap wins

A ThinkRail git-worktree IDE shipped through two additive local launchers: a native Electrobun desktop
app and the CLI that opens the browser UI. Both embed the same host and serve the same client;
the shell is built first, the agent connected last:

- **Projects → workspaces**: open a git repo as a project; a workspace is a `git worktree` (own branch +
  cwd) under `~/.thinkrail/worktrees` — plus one built-in, non-removable **Default workspace** per
  project (the project folder itself), offered as an explicit choice on the project's Welcome so
  newcomers aren't lost in the worktree model, and any **existing worktree** the user attaches in place
  from the project menu (ThinkRail uses its cwd, never touches its checkout).
- **Desktop workbench**: a recursively splittable center for files, diffs, registered documents, chats, and terminals,
  bounded to four visible groups; Projects / Specs / Files / Changes / Review and terminals may occupy
  movable auxiliary groups—vertical stacks at left/right and a horizontally grouped, alignable bottom panel.
  New workspaces place one terminal in that bottom panel by default. Each frontend window owns one locally
  persisted, resource-free frame—topology, tool placement, visibility, and geometry—reused across all of its
  opened workspaces. Open resources, previews, selection, and focus remain local per workspace and window;
  current layout never synchronizes through the host. Only custom layout presets are shared across clients.
- A workspace-local **Review** surface for the current worktree: GitHub-style anchored file/diff drafts
  are collected without starting the agent, then sent as structured context into per-file chats;
  sent records persist and the agent can resolve them. This is local review, not PR-provider integration.
- A plan-header **Open PR** action (`task-open-pr`, deterministic host-side — never agent-routed):
  pushes the workspace branch and opens or updates its GitHub PR through the user's own `gh` CLI (no
  stored tokens, no provider REST API), with the PR body rendered from the verified plan; falls back to
  a prefilled compare URL when `gh` is missing or the forge isn't GitHub. Re-press pushes updates to the
  SAME PR, never a second one. CI/Checks status, merge/squash from the app, and `glab` support are not
  part of this slice. See `packages/server/src/pr`.
- **Agent selection and install**: point ThinkRail at an ACP agent already on your system from the
  terminal, or install one in-app from the [ACP registry](https://cdn.agentclientprotocol.com) into
  `~/.thinkrail`. The bundled pi agent is the default and needs neither.
- Cheap wins the protocol already carries: per-session model pick (#1) via `providers/*`, token/cost
  display (#3) via `usage_update`, and slash-command autocomplete (#2) via `available_commands_update`.
  Read-through reuse of portable Agent Skills a user already keeps for major coding agents is a
  **pi-agent** capability — pi remains the parser/runtime; no copying or vendor-semantic emulation. A
  repo's **committed** skill aliases load only after an explicit **per-project trust** grant (a clone's are
  attacker-controlled); personal + bundled skills load regardless. External agents decide their own skill
  loading, so the grant is a pi-agent guarantee, not a universal one — the universal floor is that
  ThinkRail chooses which directories any agent is pointed at.
- Multiple chat sessions per workspace, streaming concurrently (#5).
- **ThinkRail's own transcript** of every session under `~/.thinkrail`, written as updates stream in. It
  is what makes history, cross-project search, prompt recall, jump-to-message and reopening a closed chat
  work identically with every agent, including agents that cannot reload a session.
- A bundled **spec-graph** capability: the agent searches, navigates, and manages the project's specs via
  `spec_*` tools — registered natively in the pi agent, exposed over MCP to every other agent.
- A read-only **Specs** side tool: the active worktree's spec-graph rendered as its `parent` tree, backed
  by the same agent-free spec-graph core model host-side;
  opening a node opens the spec file as an editor tab. Viewer only — no editing, drift detection, or
  graph canvas.
- ThinkRail branding: **green accent** (`#8dff4f` on the dark-family themes, `#2e7d16` on the light
  ones — inverse by appearance so it clears AA on both), Darcula background, **Orbitron** for the brand
  display role, Geist / JetBrains Mono for UI and code.
- On-disk state under `~/.thinkrail`.

V1 is explicitly **not**: the workflow **product layer** (a runtime/engine, configurable pipelines —
the skill-based workflow *system*, skills + an always-on rule with no runtime machinery, ships inside
the pi agent, and its skill documents ship as MCP prompts for other agents); the spec-graph **product
layer** beyond the read-only viewer (drift detection, pre-build approval, living graph — the agent-side
spec capability ships as above), and the V1 viewer is a read-only Specs tab over a `spec.graph` wire
read; PR/Checks automation beyond push + open/update via `gh` (CI/checks status, merge or squash from
the app, provider REST API integration, `glab` — see `packages/server/src/pr`'s Out of scope),
self-improvement, automations, per-step model routing, cost ledger.

## V2 — the product

Workflow layer (#8), spec layer (#9: pre-build approval → drift detection → living spec graph, building
on the V1 spec-graph capability), self-improvement (#4), configurable automations (#6), remote/phone over
Tailscale (#7), and deepened parallelism / cost ledger / per-step routing.
