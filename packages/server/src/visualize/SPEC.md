---
id: submodule-server-visualize
type: submodule-design
status: active
title: visualize — a terminal agent's live drawing surface
parent: module-server
references: [submodule-server-mcp, submodule-server-terminal]
tags: [v1, claude-code]
---

## Responsibility

Give an agent in a ThinkRail terminal a place to draw. The MCP `visualize` tool takes the same schema
pi's visualize extension takes (`pi-visualize/schema` — diagram with raw mermaid, or comparison cards),
records the call per terminal, and pushes it to clients, where it renders as a live workbench tab
beside that terminal. Calling again replaces that terminal's view in place — many agents can each hold
their own view at once, which is the point.

## Boundary

- **Owns:** the in-memory per-terminal store (`recordVisualization` / `getVisualization` — keyed
  workspace+tab, `revision` counting rewrites so a client can tell an update from an echo), the
  publisher seam `host` installs (`setVisualizationPublisher` → the `terminal.visualization` WS
  channel), `forgetVisualizations(workspaceId)` for workspace removal, and **`visualizeMcpTool(owner)`**
  — the MCP tool handle the host adds to a terminal's `/mcp/<token>` tool table (mcp/SPEC.md), already
  bound to the terminal the token names. The handle validates with the schema itself
  (`Value.Check` + `pi-visualize/validate`'s shape rules) and answers with the title, the revision, and
  the fact that calling again updates in place — the sentence that teaches the agent the iteration loop.
- **The title names the tab once.** `title`, else "Diagram"/"Comparison". `args` travel verbatim: the
  web renders them with the same `VisualizationCard` the chat uses for pi's visualize tool, so both
  agents draw with one vocabulary and one renderer (apps/web's chat/tools/visualize).
- **In-memory on purpose.** A visualization is the agent's scratchboard, not workspace state: it lives
  as long as the host, hydrates late-joining clients through the `visualization.get` wire method, and
  is not persisted. A client that reopens after a host restart finds the tab (frontend-local layout)
  showing its loading region until the agent draws again.
- **Public surface (barrel):** `setVisualizationPublisher`, `recordVisualization`, `getVisualization`,
  `forgetVisualizations`, `resetVisualizations` (tests), `visualizeMcpTool`.
- **Allowed deps:** `contracts` (the `TerminalVisualization`/`VisualizationPush` shapes),
  `pi-visualize/schema` + `pi-visualize/validate` (external, pi-free files of the pi package — the one
  schema both registrations share), `typebox`. No siblings; the MCP handle is structural, so this
  module never imports `mcp`.
- **Forbidden:** `host` (it installs the publisher and mounts the tool); `terminal` (identity arrives
  already resolved); any pi runtime import.
