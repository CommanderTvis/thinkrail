---
id: module-plugin-visualize
type: module-design
status: active
title: plugin-visualize — a terminal agent's live drawing surface, as a builtin plugin
parent: architecture
references: [module-plugin-api, module-plugin-ui]
tags: [v1, plugins]
---

## Responsibility

Give an agent in a ThinkRail terminal a place to draw. The `visualize` MCP tool takes the schema
`pi-visualize/schema` also gives pi's chat-side visualize extension (diagram with raw mermaid, or
comparison cards), records the call per terminal, and publishes it, where it renders as a live companion
pane beside that terminal. Calling again replaces that terminal's view in place — many agents can each
hold their own view at once, which is the point. `packages/pi-visualize` stays a core package: the server
still depends on it for the chat-surface extension, and this plugin depends on it too, for the one schema
and shape-validation both registrations share.

## Boundary

- **Owns:** the in-memory per-terminal store (`host/store.ts`: `recordVisualization` / `getVisualization`
  / `visualizationsForWorkspace` — keyed workspace+tab, `revision` counting rewrites so a client can tell
  an update from an echo), persistence over `ctx.readState`/`writeState` (`"visualizations"`, keyed
  workspace → agent session id), and the **`visualize` tool** registered through `ctx.tool` with
  `surfaces: ["mcp"]` — the loader binds it to the terminal the request's token names and hands it as
  `toolCtx.terminal`, so `runVisualizeTool` never has to resolve the owner itself. The tool validates the
  call's shape beyond what the typebox schema captures (`pi-visualize/validate`'s `validateShape`) and
  answers with the title, the revision, and the fact that calling again updates in place — the sentence
  that teaches the agent the iteration loop.
- **The renderer decides, and the agent hears it.** Mermaid is parsed in the browser, so whether a
  diagram is valid is not something the host can answer. The tool run therefore *waits* (5s, via the
  `report` method reaching `reportVisualizationRender`) for a client to report what it made of that
  revision, and answers with the parse error as an `isError` result when it failed — otherwise a typo
  produced a red card only the user could see while the agent was told it had drawn. **A refused drawing
  is rolled back**: the last one that rendered is restored and re-published, so an iteration's typo does
  not cost the user the picture they had, and the next attempt reuses the revision number the pane never
  showed. No client watching is not a failure — the wait times out and the drawing stands. A comparison
  has no mermaid to fail on and settles the moment it is shown.
- **The title names the tab once.** `title`, else "Diagram"/"Comparison". `args` travel verbatim: the
  web renders them with the same `VisualizationCard` the chat uses for pi's visualize tool, so both
  agents draw with one vocabulary (`@thinkrail/plugin-ui/visualization`).
- **A drawing belongs to the conversation, not to the tab.** The live view is keyed by terminal, but every
  drawing is also written under the agent **session id** the terminal last reported. When `ctx.onTerminal`
  delivers an `agentChanged` event naming a session that has one, `adoptVisualizationForSession`
  re-attaches it to the tab now reporting and publishes it as if just drawn — so `claude --resume <id>`
  finds its diagram whatever terminal it resumed into, and a host restart does not lose it (persistence
  survives it). Re-adopting is idempotent: a tab already holding that revision is left alone. **A tab that
  drew before it said which conversation it is** is bound to that session the moment the event arrives, so
  the ordering of "drew" and "identified itself" never decides whether a resume can find it. Removing a
  workspace (`ctx.onWorkspace` `"removed"`) forgets both indexes.
- **The wire (`contracts.ts`):** method `report` (the render verdict), method `get` (the snapshot for the
  `changed` state channel, keyed `["workspaceId"]` — its result is the whole per-workspace map, not one
  terminal's entry, since the channel's key is workspace-only). Every mutation publishes the whole
  workspace map on `changed`; the web side keeps its own per-workspace `Record<tabKey, TerminalVisualization>`
  built from that.
- **Web half (`web/`):** a `ctx.companion({ kind: "visualization", hosts: ["terminal"], … })` whose
  `useAvailable` subscribes to `changed` (scoped by workspace) into a small zustand store and reports
  availability as "this tab has an entry"; a new or updated revision calls `ctx.focusCompanion` so the
  drawing surfaces even if the pane was previously closed. `VisualizationPane` renders the kit's
  `VisualizationCard` and reports the render verdict back through `ctx.request("report", …)`. The chat's
  own inline `visualize` renderer is untouched core code — this plugin never touches it.
- **Public surface (barrel):** `contracts.ts` exports `visualizeContract`, `TerminalVisualization`,
  `VisualizationsChangedPayload`; `host/index.ts` default-exports the `PluginHostModule`; `web/index.ts`
  default-exports the `PluginWebModule`.
- **Allowed deps:** `@thinkrail/plugin-api`, `@thinkrail/contracts`, `@thinkrail/plugin-ui`
  (`./visualization`, web only), `pi-visualize` (`/schema`, `/validate` — host only; the pi-free files of
  the pi package), `typebox`, `zustand` (web store).
- **Forbidden:** any other plugin; any `pi` runtime import (the tool is pi-free, adapted by core); the
  web half never imports `apps/web` internals.
