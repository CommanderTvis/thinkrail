---
id: submodule-server-mcp
type: submodule-design
status: active
title: mcp — ThinkRail's tools, served to agents over MCP
parent: module-server
references: [submodule-server-terminal]
tags: [v1, claude-code]
---

## Responsibility

Serve ThinkRail's own agent capabilities to agents that are not pi — Claude Code in a ThinkRail
terminal today, any MCP-speaking CLI tomorrow — as a Model Context Protocol server on the host's own
HTTP endpoint. pi keeps its native in-process registration and never pays this hop; MCP is the outward
adapter over the same tool definitions, so a capability is written once and reaches every agent.

## Boundary

- **Owns:** a minimal, dependency-free **streamable-HTTP MCP server** (`protocol.ts`): single JSON-RPC
  request objects in, JSON responses out. Implemented methods: `initialize` (echoes a known
  `protocolVersion` — `2024-11-05` / `2025-03-26` / `2025-06-18` — or answers with the latest;
  advertises only `tools`), `ping`, `tools/list`, `tools/call`. Notifications are acknowledged with
  `202` and no body. JSON-RPC batches are refused (`-32600`) — the 2025-06-18 revision removed them. A
  thrown tool is an `isError: true` *result*, never a protocol error, so the calling agent sees the
  message; an unknown tool or method is a protocol error (`-32602` / `-32601`). No SSE stream, no
  `Mcp-Session-Id`: every tool here is request/response, so the server is deliberately stateless and a
  `GET` is answered 405 by the host route.
  route builds `tools` fresh per request from the resolved token's owner as
  plugin's `"mcp"`-surface tools — including `visualize` (`plugin-visualize/SPEC.md`) and
  `blueprint_check` (`plugin-blueprint/SPEC.md`), both plugin tools now, structural to no module here.
  The seven `spec_*` tools reach this table that way now — as
- **The tool table** (`tools.ts`) is built per request from `pi-spec-graph/tools`' agent-free
  `SPEC_TOOLS` definitions — the same objects pi registers natively. The typebox `parameters` schema
  *is* the published `inputSchema`, served verbatim, and the same schema validates incoming arguments
  (`Value.Check`) before `run(params, cwd)` — a mismatch is an `isError` result naming the first bad
  path, so the schema an agent read is exactly the contract enforced. A tool outcome whose details
  carry `error` is reported with `isError: true`.
- **A terminal's table can carry more than the spec tools.** `serveMcp` accepts `extraTools` — handles
  already bound to the calling terminal — which is how `visualize` joins the table
  ([[submodule-server-visualize]]): the host builds the handle from the resolved token owner, so a
  drawing lands beside the very terminal that asked for it. `blueprint_check` joins the same way, bound
  to the worktree the token resolved to ([[submodule-server-blueprint]]). Both handles are *structural* —
  neither module imports this one, and neither is named here.
- **`serveMcp`'s table is caller-supplied, not baked in.** The plugin loader passes `tools`, the complete
  table for that call — spec tools included, if the spec-dialect plugin is active — because once the spec
  dialect is a plugin, this module cannot assume `SPEC_TOOLS` belongs on every table any more than it can
  assume any other plugin's tools do. `extraTools` is a **transitional compatibility fallback**: a caller
  that has not moved to `tools` yet gets the old behaviour (`mcpToolsFor(cwd)` unconditionally, plus
  `extraTools`) — kept only because this module may not edit `host`; it is removed once every caller
  passes `tools`. `mcpToolsFor` (`tools.ts`) stays exported for that fallback and for the spec-dialect
  plugin's own use, until Stage 4a deletes it along with the plugin's `pi-spec-graph` absorption.
- **Identity comes from the route, not the payload.** The host mounts this at `/mcp/<token>` using the
  **same per-terminal token as `/agent-status/`** (terminal/SPEC.md): one identity per terminal, two
  things it can say. The host resolves token → workspace and hands this module only a `cwd`; a request
  with an unknown token or workspace dies at the route with 404 and never reaches the protocol.
- **Public surface (barrel):** `serveMcp(body, { cwd, tools?, extraTools? }) → Promise<McpHttpReply>`,
  the `McpHttpReply` type, and `McpToolHandle`. `mcpToolsFor` (`tools.ts`) is exported for the transitional
  fallback above and for the spec-dialect plugin, until Stage 4a removes it; `protocol.ts`'s generic
  handler is otherwise internal — tests reach it by file.
- **Allowed deps:** `pi-spec-graph/tools` (the agent-free tool definitions), `typebox` (schema check).
  Nothing else — no siblings, no pi runtime, no Bun APIs.
- **Forbidden:** `host` (it mounts this, never the reverse); `agent` (pi's native registration path is
  its own); any pi runtime import.

## Delivery to Claude Code

The terminal stamps `THINKRAIL_MCP_URL` into every PTY (terminal/SPEC.md), and the Claude Code plugin
ships a root `.mcp.json` whose one server entry is `{"type": "http", "url": "${THINKRAIL_MCP_URL}"}` —
Claude Code expands the variable from the terminal's own environment, so each session dials the host
carrying its own terminal's token. Outside a ThinkRail terminal the variable is unset, the URL never
resolves, and Claude Code lists the server as failed in `/mcp` — inert rather than wrong
(claude-plugin/SPEC.md).
