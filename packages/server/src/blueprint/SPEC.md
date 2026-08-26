---
id: submodule-server-blueprint
type: submodule-design
status: draft
title: blueprint — the interactive-spec format, its generator, and its change reactor
parent: module-server
depends-on: [module-contracts, submodule-server-agent, submodule-server-settings]
tags: [v1, blueprint]
---

## Responsibility

Turn one paragraph of intent into a document whose decisions are live controls, and keep that document
consistent when the reader changes one. Three things, in one module because they are one contract: the
**format**, the **file** it lives in, and what the reader's changes **tell its author**.

## Boundary

- **`blueprintBlockLines` is derived from the serializer, never from the parse.** A block's span is
  where it lands in the file the agent reads, and that file is whatever `serializeBlueprint` writes —
  so both walk the same `renderBlock`. Reporting the *input* file's line numbers would drift the
  moment a rewrite normalised the blank lines between blocks.
- **Owns:** the interactive-spec format (`format.ts` — the only parser and the only serializer), the file
  it lives in (`document.ts`), the instruction appendix and the prompts built from it (`prompts.ts`),
  selection, text edits, lock carry-over and the change diff (`reconcile.ts`), and the per-workspace
  record of what the panel last showed (`session.ts`).
- **Public surface (barrel):** `BLUEPRINT_FILE` / `blueprintPath` / `resolveBlueprintSource`,
  `describeSource`, `checkBlueprint` /
  `blueprintCheckMcpTool` / `BLUEPRINT_CHECK_DESCRIPTION`, `parseBlueprint` / `readBlueprint` /
  `serializeBlueprint` / `blueprintBlockLines` / `controlsOf` / `selectedLabels`, `BLUEPRINT_APPENDIX` / `openingPrompt`,
  `applySelection` / `applyTextEdit` / `carryOverLocks` / `diffBlueprints`, and the verbs `openBlueprint`
  / `setBlueprintAuthor` / `getBlueprint` / `noteBlueprintFileChanged` / `selectBlueprintOption` /
  `editBlueprintText` / `confirmBlueprintEdits` / `discardBlueprintEdits` / `closeBlueprint` /
  `setBlueprintPublisher`.
- **Allowed deps:** `contracts` (types), `node:fs`. The MCP handle is structural, so this module never
  imports `mcp`. **No agent runtime at all** — that is the point of the
  file: the author is somebody else's session or somebody else's terminal.
- **Forbidden:** `host` (it calls in, never out), `workspaces`, `projects`, `agent`. **A blueprint belongs
  to a workspace and is keyed by its id** — one per workspace, which is why the wire needs no separate
  blueprint id and the layout tab needs no identity beyond its kind. The host resolves the worktree path
  and hands it in.

## The format

Markdown, plus exactly one construct — a **control**, whose kind is named on its marker line:

```
!control select database
= Postgres — most conventional, widest managed hosting
- SQLite — simplest, zero operations

!control multi deploy-as
[x] Docker image — most portable
[ ] Docker Compose — easiest local multi-service
[x] Nix flake — most reproducible
```

The appendix also teaches the **house spec conventions**: frontmatter with `status: draft`, then
`## Goal` / the substance / `## Decisions` / `## Invariants` / `## Out of scope`, mirroring this repo's
own `goal-and-requirements` and `architecture` documents. The convention that lands hardest is that
**rejected alternatives are written down with their reasons** — which is exactly what a control's
unselected options already are, so the format and the house style agree rather than compete.

The governing constraint is a contradiction: expressive enough to carry a control with alternatives and
the axes you would choose along, simple enough that any competent agent emits it reliably from one
paragraph of instruction, with no examples to study and no validator in the loop.

- **JSON and XML shapes were rejected.** Models emit them worse than prose and break them more often, and
  a broken brace costs the whole document, not one block. Markdown is what a model writes best.
- **A blank line ends a block; nothing closes it.** There is no `!end`, so a stream truncated mid-block
  is still a document, and the last block simply has fewer options than it will have in a second.
- **The id names the question, never the answer** (`database`, not `postgres`). It is the whole identity
  model: it is what survives regeneration, and it is why the reader's choices are not lost on the first
  reaction. An id-less marker gets a positional fallback id, which is deliberately fragile — a document
  that regenerates with different ids loses the choices attached to them, and there is no similarity
  matching to paper over it.
- **The axis carries more than the alternative.** A reader knows the property they need ("fastest",
  "widest plugin ecosystem") and usually does not know the instances. So every option line is
  `Label — why you would pick it`, and the appendix insists on it. Any of an em dash, an en dash, ` -- `,
  ` - `, or `: ` is accepted as the separator, because a model will use whichever its training favours.
- **Every default is filled in.** There are no empty fields and no questions back to the reader: this is
  sixty controls already made, of which the reader changes two.
- **The kind vocabulary is open, and unknown kinds degrade rather than vanish.** `select` is exactly one
  answer, `multi` is any number including none — a set is not a choice, and forcing "deploy targets" into
  a single pick is a lie about the design. A marker naming a kind the host does not know is read as
  `select` with that word taken as the id, so a future `!control scale throughput` shows up as a control
  rather than disappearing into prose. When the kind is missing entirely, the **first option line's
  syntax decides**: `[x]`/`[ ]` means `multi`, `=`/`-` means `select`. Every extra kind costs a paragraph
  of the appendix, which is the budget that governs how many there can ever be.

## Three sources, one document

A blueprint starts from a **`BlueprintSource`**: an `idea` (the brief, as before), the `product` (this
worktree), or a `spec` (a markdown document already in it). The first writes down a decision nobody has
made yet; the other two are **takeovers** — the decisions exist, in code or in prose, and the author's job
is to surface them as controls someone can change.

- **A takeover writes `BLUEPRINT.md` and touches nothing else.** The source is read, never rewritten: a
  document the reader wrote keeps its own history and its own place in the spec graph, and a spec that
  quietly ate its own source would be unforgivable the first time the extraction was wrong. It is also
  what keeps the module's one invariant — one blueprint per workspace, always at the worktree root — so
  the wire, the panel and the watcher stay exactly as they were.
- **The prompt is the whole difference.** `openingPrompt(source)` says what to read; the appendix, the
  format, the parser, the reactor and the file are shared. A takeover adds one instruction the idea path
  does not need: the decision *as it actually is* is the selected option, the alternatives are the ones a
  rewrite would seriously consider with the property that would make someone switch, and a question the
  source does not answer is not a control. That last clause is what stops an extraction inventing a
  datastore for a project that has none.
- **The appendix advertises the dialect the pane renders, and nothing it does not.** GitHub-flavoured
  Markdown through the shared `Markdown`: language-tagged fences (highlighted by shiki — a bare fence is
  told to be a mistake, since it renders as grey text), tables for comparisons, task lists, GitHub
  callouts (`> [!NOTE]` … `[!CAUTION]`, which `BlueprintView` renders through the same
  `remarkGithubAlerts` the file preview uses), and Mermaid fences for diagrams — never ASCII art, since
  box-and-arrow text in a code block does not wrap, cannot be read at panel width, and is a diagram only
  to a monospace font; the first drafts drew the shape of the system that way, and the panel showed a
  horizontally scrolling fragment. `e2e/blueprint-watch.spec.ts` pins that a Mermaid fence renders as SVG
  and a callout renders as a callout inside the pane.
- **Flipping a control still only rewrites the document.** A taken-over spec reacts exactly like a drafted
  one; turning "Ktor → Quarkus" into a migration is an ordinary conversation with the same agent, not a
  button. The document is a decision record, and a control that silently started rewriting a real codebase
  would be a different product with a different risk profile.
- **`resolveBlueprintSource(worktreePath, source)` is the door check** (`document.ts`): a brief must have words, and a `spec` path must resolve inside the worktree to an
  existing file, stored **relative** because that is what the prompt says out loud. It runs before a
  workspace, an agent or a terminal is spent on the request.
- **`describeSource`** is the one line the panel shows above the document — the brief, or what it was taken
  over from. It is display only; `blueprints.json` records the *source*, so a restored blueprint rebuilds
  the same opening prompt rather than a paraphrase of it.

## The file is the document, and its author is a visible agent

**The specification is `BLUEPRINT.md` at the root of the worktree**, written by the agent with ordinary
file tools. That single decision is what lets the author be an *interactive* agent the reader can talk
to — a pi chat, or `claude "<opening prompt>"` in a terminal — instead of a headless `--print` run with
no input and no face. An earlier revision generated the document from a hidden second process; the reader
then had two agents, could only speak to the one that was not writing, and the panel showed work nobody
could steer. That is the mistake this shape exists to avoid.

- **Claude's session id lives on the author record, not on the terminal.** The terminal module already
  offers a `--resume` prefill, but only across a *host restart*: closing the tab kills the PTY and the
  offer with it, which is the common case here. So the host's `/agent-status/` route — the same delivery
  that remembers the id on the terminal — calls `noteBlueprintAuthorSession` to record it onto the
  blueprint, and `blueprint.authorCommand` composes `claude --resume <id>` when the pair is reopened.
  This wiring once lived only behind the OSC-era `terminal.rememberAgent` method, which nothing calls
  since the plugin moved to HTTP, so no blueprint ever recorded its author's id and every reopen fell
  into the fallback below — with the fallback then being the opening prompt, a reopen rewrote the spec.
- **The record outlives the process.** `blueprints.json` keeps the source, the agent, and the author per
  workspace, so closing the panel or restarting the host does not turn the spec into an orphan file
  nobody can talk to: `getBlueprint(workspaceId, worktreePath)` rehydrates from it and re-reads the file.
  `closeBlueprint` is the only thing that forgets a blueprint, and even then the file stays.
- **The file is a spec-graph node.** The appendix has the author open it with `id` / `type` / `status` /
  `title` frontmatter, so the Specs tool lists it like any other spec rather than showing "No specs" next
  to a document that plainly exists. The parser **splits that frontmatter off and round-trips it
  verbatim** — rendering it as prose would put YAML at the top of the page. The pane shows it as the
  same properties table a markdown file gets, and an edit there is a text edit with the
  `{ kind: "frontmatter" }` target: staged with the prose edits, written on confirm, the whole block
  replaced at once (the client rebuilds it through the properties editor's `withFrontmatter`).
- **Nobody reports to the panel.** The author is an ordinary agent using ordinary tools, so the file
  watcher is how the panel learns anything: `noteBlueprintFileChanged` re-reads, re-parses, and publishes.
- **The parser stays the tolerant one.** A half-written file is read exactly like a half-streamed one —
  partial syntax is held back, an opened control with no options yet renders as pending. That is why the
  document appears as the agent types it, without anything streaming over the wire.
- **`awaiting` vs `ready`** is only "does the file exist yet". There is no run to be in the middle of.

## The author hears what the panel read

The tolerant parser is what makes a half-written file renderable, and it is also what makes an author
blind: an unknown kind word becomes a `select`, a missing id becomes a positional one, an option with no
axis renders as a bare label, and nothing anywhere says so. **`blueprint_check` is the one tool this
module gives an agent**, and it exists to close exactly that loop — the same loop the visualize tool
closes by returning the renderer's verdict ([[submodule-server-visualize]]).

- **The document does not move to a tool.** The blueprint stays a file the author writes with ordinary
  file tools. Routing the document itself through a tool call would end in the same `fs.write` one hop
  later, cost the incremental render the watcher gives for free, and make an MCP surface a *requirement*
  for authorship where today `--append-system-prompt` and a Write tool are enough. So the tool reads and
  reports; it never writes.
- **`readBlueprint` is the parse plus what it had to decide**, and `parseBlueprint` is that same function
  with the notes dropped. One parser, one pass — a second scanner looking for the same syntax would drift
  from the one that renders. A note is raised where the parse had to choose *for* the author: a kind word
  that is not `select`/`multi` (whose trailing word is then dropped entirely), a marker with no id, an id
  already taken, a control with no options, an option with no reason after it.
- **`checkBlueprint(worktreePath)` reports the controls the way the panel shows them** — id, kind, option
  count, what is selected — and then the notes. A missing file is `isError`: the author asked about a
  document it believes it wrote, and the honest answer is that it wrote nowhere.
- **Both authors get the same tool from one implementation.** `blueprintCheckMcpTool(cwd)` is the
  structural MCP handle the host adds to a terminal's table (mcp/SPEC.md), and the host installs the same
  `checkBlueprint` into `agent`'s `setBlueprintCheckTool` seam for pi's native registration
  ([[submodule-server-agent]]) — `agent` may not import a sibling feature, which is what the seam is for.
  The appendix can then instruct both authors identically, which is the whole point of "two agents, one
  format".

## The reactor

The reader changes one select; the same agent that wrote the document is handed the whole thing and told
to bring it back into a consistent state. **The machinery deliberately does not know whether a choice is
local or global** — Python to Haskell demolishes half the document, Docker to Nix touches nothing, and
that judgement belongs to the model.

- **A choice lands in the file immediately.** The control never appears to snap back while the agent
  thinks, because the reader's change is already on disk before the author hears about it.
- **Explicit choices are enforced, not requested.** `applySelection` marks a control `locked`; the prompt
  asks the author to honour every locked choice, and `carryOverLocks` then makes it true regardless of
  what the file comes back containing — a locked option the author dropped is put back rather than
  silently re-decided. A median default may be re-decided freely; a choice the reader made by hand may
  not.
- **What moved is reported, not gated.** `diffBlueprints` compares the file against what the panel last
  showed, so the author's rewrite arrives with the list of what changed. There is no accept/discard step:
  the file *is* the document, and a reader who wants the old wording asks the author for it — or reaches
  for git, which is one more reason the spec is a file in a worktree.

## Two agents, one format

The format is proved on two different *hosts*, because one that only a single runtime can produce is a
format tied to a vendor. Neither is special-cased in this module — both are handed `BLUEPRINT_APPENDIX`
and `openingPrompt`, and both write the same file.

- **`pi`** — a chat session in the workspace. The opening prompt is sent as its first message.
- **`claude`** — `claude --append-system-prompt <appendix> "<opening prompt>"` in a workspace terminal.
  Interactive on purpose: `--print` would give a spec nobody can talk to. Gated on
  `AppConfig.claudeCodeEnabled`, like every other Claude Code surface.

## Out of scope

Streaming — the file appears as the agent writes it, and that is the whole of it; nothing streams over
the wire. Also out: more than one blueprint per workspace,
navigation between blueprints,
ranking controls by how much they drag with them, and turning an accepted blueprint into a project.

## Bringing the author back

Reopening the pair must bring the *running* author back, not a prompt with a resume typed into it.

- **`blueprint.authorCommand` reuses the terminal module's resume, it does not restate it.**
  `agentSessionExists` refuses a conversation that never reached disk and `resumeCommand` normalises the
  flags. An id that resolves to nothing must **never** fall back to the opening prompt while
  `BLUEPRINT.md` exists: that prompt says "write the file", and a fresh author obeying it over a document
  full of the reader's decisions is the worst outcome this feature can produce. The fallback is
  `claude --append-system-prompt <appendix> --continue` — the worktree is dedicated to this spec, so its
  most recent conversation *is* the author. Only with no file on disk is the opening prompt offered.
  `e2e/blueprint-watch.spec.ts` pins both halves: an author with no recorded id gets `--continue`, and a
  plugin report from its terminal records the id so the next offer is `--resume`.
- **The layout restoring the tab is not the author coming back.** After a host restart the author's tab is
  still in the layout, so the client's restore sees it as present and issues nothing; the PTY behind it is
  new and empty. What fills it is the terminal module's generic resume offer, which is deliberately left
  unsubmitted. `host` therefore registers this workspace's author tab with `setResumeRunPolicy`
  ([[submodule-server-terminal]]), which is what turns that offer into a session that is actually running.
