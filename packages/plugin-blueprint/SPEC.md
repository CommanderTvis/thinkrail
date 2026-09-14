---
id: module-plugin-blueprint
type: module-design
status: active
title: plugin-blueprint — the interactive-spec format, its author, and its change reactor
parent: module-plugin-api
depends-on: [module-plugin-api, module-contracts, module-shared, module-plugin-ui, module-plugin-spec-dialect]
references: [module-server, module-web]
tags: [v1, plugins, blueprint]
---

## Responsibility

The worked example of one builtin plugin depending on another (`plugin-adoption.md`, "Blueprint,
builtin"). Turns one paragraph of intent into a document whose decisions are live controls, kept
consistent when the reader changes one, and reads it as a spec-graph node through its declared
dependency on `spec-dialect`. Moved out of core as part of the plugin-api adoption; before this
move, `packages/server/src/blueprint/SPEC.md` documented the format, the file, and the reactor — that
content folds in here unchanged except where the plugin boundary itself forced a rewrite (delivery,
identity, dependency).

## What moved unchanged, and what didn't

`host/document.ts`, `format.ts`, `prompts.ts`, `reconcile.ts` and their tests moved verbatim — parser,
serializer, prompts and the reactor logic have no host dependency and no reason to change. `check.ts`
lost its bespoke `blueprintCheckMcpTool` handle (the loader's own `ctx.tool(...)` with
`surfaces: ["agent", "mcp"]` replaces the two hand-wired registration sites) and gained the spec-dialect
dependency check (below). `session.ts` moved with one real change: `blueprints.json` via
`../persistence` became a `BlueprintStore` seam (`setBlueprintStore`), installed by `host/index.ts` as
`ctx.readState`/`ctx.writeState`; the module defaults to an in-memory store so its own tests need no
host at all, matching the fake-context pattern `plugin-spec-dialect/host/index.test.ts` established.

Nine wire methods lost one (`authorCommand` — composing a resume/continue command line is now the
Claude launcher's own `terminalCommand`, called from the web half) and `open`'s result gained
`systemPrompt` (the appendix text) in place of `command` (a composed shell line) — the web half composes
the command itself, through whichever launcher the reader picked, rather than the host special-casing
Claude.

## Host-side delivery (H10/H11)

`select` and `confirmEdits` used to return a `reconcile` string the *client* delivered — a chat author via
`session.prompt` (which throws while the session streams), a terminal author via a client-side
`queueTerminalInput` that only works with an attached tab. Both handlers now deliver it themselves:
`ctx.sendToSession(sessionId, text)` for a chat author (steers rather than prompting raw, so it does not
throw mid-stream), `ctx.writeTerminal({workspaceId, tabKey}, \`${text}\r\`)` for a terminal one — the
exact bytes the web's `queueTerminalInput` path used to send, now written host-side so no attached client
is required. The wire results carry only `{ ok: true }`; nothing is left for the web to deliver.

## The `changed` channel is keyed, not broadcast

The fork's `blueprint.changed` was one global channel every socket subscribed to, filtered client-side by
`state.workspaceId`. Under the plugin API a state channel names its snapshot (`get`) and its key
(`workspaceId`); `get`'s result is shaped exactly like the channel's payload
(`{ state: BlueprintState | null }`) because the web loader's snapshot-then-stream hydration passes a
snapshot result straight through as the first push, with no transformation — the two schemas are the
same value for that reason, not by coincidence.

## The spec-dialect dependency, exercised

`blueprint_check`'s host handler, after reporting the parse itself, calls
`ctx.dependency(specDialectContract).request("graph", { workspaceId })` and names it in the report when
`BLUEPRINT.md` is not among the returned nodes' paths — the "declared dependency, exercised" the plan
calls for, not merely a manifest-level `dependsOn` entry. Nothing else in the plugin reaches into
spec-dialect: the appendix still just asks the author for `id`/`type`/`status`/`title` frontmatter, and
the dependency call is what turns "the graph happens to see it" into something the author is told about.

## Entry points: two workspace actions, project scope included

`BlueprintStartDialog` used to be reached from three hand-wired `onDraftBlueprint` props
(`ProjectTree`, `NewProjectDialog`, `WelcomePanel`) plumbing a project id into one dialog. `W10`'s
`ctx.workspaceAction` originally only fit a *workspace* context (`{ workspaceId, groupId }`), not a bare
project id with no workspace chosen yet; it now takes a `scope`, `"workspace"` (default) or `"project"`,
and a project-scoped registration's component receives `{ projectId }` instead. The plugin registers
one action of each scope: `draft-blueprint` (workspace, unchanged — a button in an already-open
workspace's center-actions bar, finding its project via a scan of `HostProjection.workspaces` from the
workspace id, the same shape `contextProjectId` uses) and `draft-blueprint-project` (project,
self-styled as a Welcome-screen card and reused verbatim as the post-creation offer in
`NewProjectDialog`) — both open the same `BlueprintStartDialog`.

## Bringing the author back, and submitting the opener

Two W-capability gaps surfaced while porting that `plugin-adoption.md`'s capability list did not
anticipate; both are now closed rather than documented around:

- **`BLUEPRINT.md` is a pointer to its author, not a standalone document tab.** Its file-viewer open
  hook claims the navigation and opens the AI author; the Blueprint renders as that chat or terminal's
  companion illustration. Raw source is an explicit action inside the illustration. A failed author open
  is surfaced as an error instead of silently degrading to a detached Blueprint tab. If an older layout
  restores such a detached tab, the file-viewer body closes it and redirects to the author.
- **Opening a blueprint starts or resumes the author.** `openBlueprintPair` restores a recorded chat by
  session id or creates a bundled chat when recovery is impossible. A terminal in the host catalog is
  attached through `openTerminal` in the main column because catalog presence does not prove its layout
  tab is visible or correctly placed; a closed terminal is resumed only when its Claude session id was
  recorded, otherwise it is replaced by a
  new bundled chat rather than guessing with `--continue`. The companion is focused after its host opens.
- **Reopening a closed terminal author.** `openTerminal`'s `tabKey` places and selects a terminal, and
  a `terminal` author's `agentSessionId` (recorded on the record, not the terminal — see above) is
  exactly what the Claude launcher's own `terminalCommand({ resume })` needs to compose a resume line.
  `blueprintOpen.ts` calls it with the author's `tabKey` and `agentSessionId` when both are recoverable.
- **Submitting the opening prompt on chat start.** `ctx.openChat(workspaceId, { prompt })` now submits
  the prompt (`session.prompt`, with the same optimistic `appendUserMessage` the rest of the app uses)
  instead of staging it as an unsent draft, so a fresh chat author starts writing immediately, as it did
  before the move.

## Boundary

- **Owns:** `manifest.ts`, `blueprintFile.ts` (`BLUEPRINT_FILE`, alone, so it stays typebox-free —
  `contracts.ts` re-exports it for `host/` to keep importing from one place, but `manifest.ts` and every
  `web/` file that needs the constant import it from here directly, never through `contracts.ts`),
  `contracts.ts` (the Blueprint domain types, moved from `packages/contracts/src/blueprint.ts`, as
  typebox schemas plus `Static` projections), `host/` (format, prompts, reconcile, session, check,
  activation), `web/` (the pane, the controls, the start dialog, the open dispatcher, its own zustand
  store), `build-support.ts` (no `pi` block, so an empty one).
- **Public surface:** `./manifest` (`manifest`, `BLUEPRINT_ID`), `./contracts` (`blueprintContract` and
  every domain type/schema, plus the re-exported `BLUEPRINT_FILE`), `./host` (default export, a
  `PluginHostModule`), `./web` (default export, a `PluginWebModule`), `./build-support` (`buildSupport`).
- **Allowed deps:** `@thinkrail/plugin-api` (+ `/host`, `/web`), `@thinkrail/contracts`,
  `@thinkrail/shared`, `@thinkrail/plugin-ui`, `@thinkrail/plugin-spec-dialect/contracts` (types and the
  contract value, for `ctx.dependency`), `typebox`, `zustand`, `react`.
- **Forbidden:** `@thinkrail/server`, `apps/*`, another plugin's host half, the app's
  store/transport/panels/chat modules.

## Tests

`host/*.test.ts` moved with their modules (format, reconcile, session, check, takeover); `session.test.ts`
now exercises the module's default in-memory store rather than real files.
`host/index.test.ts` builds a minimal fake `PluginHostContext` (as `plugin-spec-dialect` does) and pins:
open/get/select round-tripping through the record, host-side delivery to both a chat and a terminal
author, a terminal's reported agent session landing on the author record and feeding the revive hook,
and `blueprint_check` both registering on both surfaces and naming an unindexed document via the
spec-dialect dependency. `web/store.test.ts` pins `blueprintAuthors`, moved from
`apps/web/src/panels/coreCompanions.test.ts`. `web/blueprintOpen.test.ts` pins `restoreAuthor`: a fake
`PluginWebContext` with a "claude" launcher and no matching terminal in `host().terminals` gets
`openTerminal` called with a `--resume`/`--continue` command built from the author's `agentSessionId`.

## History

Moved out of core as part of the plugin-api adoption (`plugin-adoption.md`, "Blueprint, builtin").
Before this move, `packages/server/src/blueprint/SPEC.md` documented the format, the file, and the
reactor in full; that content is preserved above except where the plugin boundary forced a rewrite.
