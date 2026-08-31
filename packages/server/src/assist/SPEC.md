---
id: submodule-server-assist
type: submodule-design
status: active
title: assist — pure naming helpers over a transcript
parent: module-server
depends-on: [module-contracts]
references: [architecture, submodule-server-host, submodule-server-transcript]
tags: [v1, naming]
---

## Responsibility

Turn a chat's first turn into a **workspace display name**. Every function here is pure: text in, text
out, no I/O, no model, no session. The host's auto-rename flow (`host/autoRename`) owns the turn gating,
the pristine check and the rename itself; assist only produces a **display name**, never a branch —
branch derivation belongs to `workspaces`.

## The model call is gone, and why

This module used to have two halves: `naiveWorkspaceName`, a pure heuristic shown instantly, and
`suggestWorkspaceName`, a cheap-model refinement over `agent.completeOnce`. **ACP has no non-session
inference** — the protocol's only way to reach a model is `session/new` + `session/prompt`, so the
refinement could only be re-implemented as a real, short-lived agent session.

That was rejected. Under [[architecture]] Decision #15 every session is durable: a naming session would
spawn (or borrow) an agent process, open a transcript, land in `session.list` and the search corpus, and
bill the user's provider — all to improve a two-word label the user can rename by hand. It would also
need the agent to be authenticated before a workspace could be named, turning a cosmetic nicety into a
hard dependency on provider setup.

So naming **degrades to the naive path**: the instant heuristic name is now the final name. This is
listed among the migration's honest losses — the agentic refinement does not exist for any agent,
including the bundled pi one. `toWorkspaceName` survives because it is the normalization any future
model-produced name would need, and the naive path is still the only producer today.

## Boundary

- **Owns:**
  - `naiveWorkspaceName(prompt)` — pure, **non-agentic** raw-prompt → short **Title Case** name (or
    `null` on a blank/unusable prompt). Grows a word at a time to *at least* a minimum (so a run of very
    short words still reads) and stops *before* a maximum (words + chars), then Title Cases and joins
    with spaces.
  - `toWorkspaceName(raw)` — pure free-text → safe display-name normalization (strip wrapping
    quotes/backticks, drop other punctuation to spaces, collapse whitespace, clamp words + length) that
    **preserves the source casing**, so `Add OAuth login` survives.
  - `extractFirstTurn(messages)` — pure: pull the first **clean** `{ prompt, answer }` turn out of a
    ThinkRail transcript (`ChatMessage[]`), or `null` if there is none.
    - A **hidden** user message is not a turn. The host's own control traffic is written `hidden`, and a
      wake-nudge must never become a workspace name.
    - **Killed turns are skipped, not just gated.** A turn is killed when its **last**
      `turnSettled` marker stops `failed`, `cancelled` or `refused` — the ACP-era replacement for pi's
      `error`/`aborted` stop reasons. Naming from a retracted prompt is the failure mode this rule
      exists for: an aborted first prompt must not become the name once a later turn settles cleanly.
      Judging by the *last* settlement in the turn is deliberate — a turn that settled once and was
      then retried and cancelled is killed, not clean.
    - The **answer** is the first assistant message's text in that turn; a turn with no assistant text
      yet still names fine (`answer: ""`).
- **Public surface (barrel):** `naiveWorkspaceName`, `toWorkspaceName`, `extractFirstTurn`;
  `WorkspaceNameTurn`.
- **Allowed deps:** `contracts` (`ChatMessage` / `UserMessage` / `AssistantMessage` / `PromptContent` /
  `StopReason`) — types only. Nothing else: no sibling, no Node, no network.
- **Forbidden:** `host`; `agent` (the edge that carried `completeOnce` is **deleted**, not dormant);
  **any pi package**; **any ACP type**; reading session state itself — settled-turn gating is the
  caller's job.

## Get right

- **No I/O here, ever.** The moment a helper needs a session, a file or a clock it stops belonging to
  this module: it becomes a host-composed flow that calls in.
- Every helper still **degrades to `null`** rather than throwing — a naming failure must never block
  workspace creation, and the caller supplies the deterministic `workspace-N` default.
