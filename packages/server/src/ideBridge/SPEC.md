---
id: submodule-server-ide-bridge
type: submodule-design
parent: module-server
status: draft
title: ideBridge — the IDE side of Claude Code's editor integration
depends-on: [module-contracts, submodule-server-claude-config]
tags: [v1, claude-code]
---

## Responsibility

Be the thing a `claude` CLI running in a ThinkRail terminal connects to when it looks for an IDE: publish
the discovery lock file, serve the MCP-over-WebSocket protocol Claude Code's own editor extensions serve,
push the active selection at it, and let it drive this editor back.

## Off by default

Part of the `AppConfig.claudeCodeEnabled` surface ([[submodule-server-claude-config]]). With the setting
off no port listens and no lock file exists — and toggling it in Settings starts/stops the bridge
immediately rather than only hiding UI, because a lock file is an advertisement to any CLI on the machine,
not a UI affordance.

## Boundary

- **Owns:** the WebSocket+MCP server (`ideBridge.ts`), the JSON-RPC/MCP framing and the tool catalogue
  (`mcp.ts`), and the `~/.claude/ide/<port>.lock` discovery file (`lockFile.ts`).
- **Public surface (barrel):** `startIdeBridge`, `stopIdeBridge`, `ideBridgePort`, `setIdeBridgeDeps`,
  `refreshIdeBridgeWorkspaces`, `applySelectionChanged`, `applyDocumentClosed`, `settleAction`,
  `SSE_PORT_ENV`.
- **Allowed deps:** `claudeConfig` (`claudeHome`), `@thinkrail/shared/freePort`, `contracts` (types),
  Node/Bun.
- **Forbidden:** `host`; sibling features. The host injects `dispatch` + `listWorkspaceFolders` rather
  than this module reaching for `workspaces` or a socket, the same publisher-injection seam every other
  module uses.

## The protocol is Anthropic's, undocumented, and reverse-engineered

None of this is a published interface. It was read off the official VS Code extension bundle and the
`claude` binary, so **`mcp.test.ts` pins the wire constants** — the auth header
(`x-claude-code-ide-authorization`), the MCP protocol version, and every tool name — as the explicit
statement of what we believe the CLI expects. A CLI update that changes them breaks discovery silently;
the pinned test is what turns that into a visible diff rather than a mystery.

## Decisions

- **Discovery is the lock file, and the env var is the fast path.** `~/.claude/ide/<port>.lock` carries
  `{pid, workspaceFolders, ideName, transport: "ws", runningInWindows, authToken}` — the exact shape the
  CLI parses. For a terminal ThinkRail spawned we skip discovery entirely by exporting
  **`CLAUDE_CODE_SSE_PORT`** into its environment (`terminal/terminalManager.ts`'s `ptyEnv`), which is
  what the VS Code extension does; the lock file still exists so a `claude` started some other way (tmux,
  an external terminal cd'd into the worktree) can still find us by matching its cwd against
  `workspaceFolders`. That list is republished whenever a workspace is created or removed, since a folder
  we never advertised matches nothing.
- **The auth token gates the upgrade, not the messages.** It is minted per bridge start, lives only in
  the 0600 lock file and this module's memory, and a socket presenting the wrong one is refused at the
  HTTP upgrade with 401 rather than connected-then-ignored.
- **Stale lock files from a previous run are cleared at start, but only ours.** A hard kill never runs
  `stop()`, leaving a file that advertises a dead port; `removeOwnStaleLocks` deletes only files whose
  `ideName` is ours *and* whose `pid` is not a live process, so another editor's lock file on the same
  machine is never touched.
- **Every connected CLI is served.** The bridge holds a *set* of sockets: each one gets the editor's
  notifications, each one may call tools, and a socket that closes is simply forgotten.
  This is a deliberate departure from the official extension, which keeps one CLI and evicts the previous
  connection on every new one. That rule costs an editor almost nothing — one window, one project, one
  terminal running `claude`. Here it was the single worst thing about the integration: one bridge serves
  the whole host and every ThinkRail terminal is handed the same `CLAUDE_CODE_SSE_PORT`, while the app's
  whole shape is many terminals across many workspaces. Starting a second Claude Code anywhere in the app
  took the bridge off the first, and because a CLI retries, the two then took it off each other in turn —
  the visible symptom was a session reporting `Failed to connect to ThinkRail` with nothing in the app to
  explain why, and it cost a first-time user several minutes to work out that another session was holding
  the socket. Broadcasting costs a `Set` and one loop.
  What multiple clients share is the selection state below: all of them read the same "what is the user
  looking at", which is the same single answer the write-side tools already infer their workspace from. A
  **bridge per workspace** — its own port and lock file per worktree — remains the way to make that answer
  per-workspace rather than per-host; it is no longer the way to let two sessions coexist.
  `sockets.test.ts` stands a real bridge up and dials it twice: the rest of this module's tests reach the
  dispatch seam directly, and how many sockets may hold it is exactly the part that seam cannot show.
- **The workspace for a write-side tool is inferred from the last selection.** The CLI never sends one —
  its model is one IDE window, one project. `openFile`/`close_tab`/… therefore act in the workspace whose
  editor most recently reported a selection, and refuse outright when there has been none, rather than
  guessing at the first open workspace.
- **`getLatestSelection` deliberately outlives its document.** It is the tool that answers "what was the
  user looking at", so `applyDocumentClosed` clears `currentSelection` but leaves `latestSelection`
  standing — that asymmetry is the whole difference between the two tools and is pinned by test.
- **Presence and selection travel on one notification, and only a non-empty one is remembered.** The
  client reports the file the user is *in* as an ordinary `selection_changed` with empty text and a
  collapsed range, which is what makes a CLI say "In README.md" after a bare tab switch. Since walking
  through files then produces a stream of empty selections, `latestSelection` only advances when the text
  is non-empty: otherwise opening a second file would erase the passage the user highlighted in the first,
  which is exactly what `getLatestSelection` exists to hand over. `currentSelection` follows every report,
  presence included, because that one really is "where the user is now".
- **An action is a request/reply with a timeout, correlated by id.** The host pushes it on
  `ideBridge.action` to every client; the first reply settles it and later ones are dropped. Two open
  browser tabs will therefore each *perform* the action (both open the file) while only one reply counts
  — acceptable because the layout is already synced across clients, but it is a known asymmetry rather
  than a designed one. A client that never answers fails the tool call after `ACTION_TIMEOUT_MS` instead
  of hanging the CLI forever.

## What is honestly not implemented

- **`openDiff` does not show a diff.** Claude Code uses it to propose *unsaved* content for review;
  ThinkRail's diff tabs read both sides from git and have no representation for "a buffer that exists
  only in the agent's head". The action opens the target file instead and reports `diffShown: false` —
  the CLI's flow continues, and nothing pretends the diff was displayed.
- **`saveDocument` saves nothing** and `checkDocumentDirty` always reports clean: every editor here is
  read-only against the host's copy of the file, so there is no unsaved buffer to flush. Both answer
  truthfully for this editor rather than emulating one that can hold dirty state.
- **No `diagnostics_changed` / `getDiagnostics`.** ThinkRail has no language server, so there are no
  diagnostics to report; the tool is absent rather than present-and-empty.
- **No `at_mentioned`.** There is no "add selection to Claude" gesture in the UI yet to fire it.

## Validation

- `mcp.test.ts` — JSON-RPC parsing (ids, notifications, malformed input, a non-scalar id), success/failure/
  notification framing, the MCP text-content wrapper, and the pinned header/version/tool-name constants.
- `ideBridge.test.ts` — selection reporting, the current-vs-latest asymmetry across a document close,
  workspace-folder listing, an action round-trip and its failure path, a dropped reply for an unknown id,
  failing fast with no client attached, refusing a write-side tool with no workspace to infer, an unknown
  tool name, and `openDiff`'s snake_case argument mapping.
