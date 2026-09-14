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
- **The tool table is entirely caller-supplied.** `serveMcp(body, tools)` is a thin wrapper over
  `protocol.ts`'s `handleMcpMessage` — this module bakes in no tool table of its own any more. The host
  route builds `tools` fresh per request from the resolved token's owner as
  `plugins.mcpTools(owner, worktreePath)`, the plugin registry's per-terminal table of every active
  plugin's `"mcp"`-surface tools — including `visualize` (`plugin-visualize/SPEC.md`) and
  `blueprint_check` (`plugin-blueprint/SPEC.md`), both plugin tools now, structural to no module here.
  The seven `spec_*` tools reach this table that way now — as
  `@thinkrail/plugin-spec-dialect`'s contribution, not a fixed import here — so a disabled spec-dialect
  plugin means no spec tools on the table, exactly like any other plugin. (History: this module used to
  build `SPEC_TOOLS` from `pi-spec-graph/tools` itself, via a since-removed `tools.ts` and an
  `extraTools` transitional fallback; both are gone as of the plugin-api move.)
- **Identity comes from the route, not the payload.** The host mounts this at `/mcp/<token>` using the
  **same per-terminal token as `/agent-status/`** (terminal/SPEC.md): one identity per terminal, two
  things it can say. The host resolves token → workspace and hands this module only a `cwd`; a request
  with an unknown token or workspace dies at the route with 404 and never reaches the protocol.
- **Public surface (barrel):** `serveMcp(body, tools) → Promise<McpHttpReply>`, the `McpHttpReply` type,
  and `McpToolHandle`. `protocol.ts`'s generic handler is otherwise internal — tests reach it by file.
- **Allowed deps:** none beyond its own files — no siblings, no pi runtime, no Bun APIs. Each caller's
  `McpToolHandle`s carry their own schema validation.
- **Forbidden:** `host` (it mounts this, never the reverse); `agent` (pi's native registration path is
  its own); any pi runtime import.

## Delivery to Claude Code

The terminal stamps `THINKRAIL_MCP_URL` into every PTY (terminal/SPEC.md), and the Claude Code plugin
ships a root `.mcp.json` whose one server entry is `{"type": "http", "url": "${THINKRAIL_MCP_URL}"}` —
Claude Code expands the variable from the terminal's own environment, so each session dials the host
carrying its own terminal's token. Outside a ThinkRail terminal the variable is unset, the URL never
resolves, and Claude Code lists the server as failed in `/mcp` — inert rather than wrong
(claude-plugin/SPEC.md).
