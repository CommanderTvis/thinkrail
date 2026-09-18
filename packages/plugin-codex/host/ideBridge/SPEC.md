---
id: submodule-codex-ide-bridge
type: submodule-design
status: active
title: Codex IDE context IPC transport
parent: module-plugin-codex
---

Owns Codex's length-prefixed JSON IPC transport, router membership, discovery, routing, and
listener lifetime. Public surface: `startIdeBridge`. Depends only on Node built-ins. It must
not read editor state, plugin settings, workspace files, or import other plugins. Its caller
supplies workspace eligibility and an asynchronous context reader.

`index.ts` composes `connection.ts` and `protocol.ts`. `connection.ts` owns the socket lifecycle
and consumes `router.ts`; both consume `protocol.ts`. These files are one private implementation,
not sibling submodules. The barrel is the only entry for the rest of the plugin.

Protocol reference: openai/codex `codex-rs/tui/src/ide_context{.rs,/ipc.rs}`. JSON frames have a
four-byte little-endian byte length. Requests use `method: ide-context`, `version: 0`, and
`params.workspaceRoot`. Successful responses have `result.ideContext`. A provider initializes
with `clientType: vscode` (the existing router's editor-client vocabulary), answers discovery
only for workspaces it serves, and rejects unknown versions and methods explicitly. This is
wire compatibility, not a claim that ThinkRail runs VS Code.

When no router exists, the owned router supports initialize, discovery, request/reply forwarding,
and broadcasts. It uses fresh forwarded ids and checks the sending socket, preventing collisions
and replies from another client. Disconnect, timeout, and disposal settle pending requests.
Provider reconnect uses one timer; it cannot revive after disposal. A stale Unix socket is
removed only after ECONNREFUSED, checking its user ownership and inode again. Existing files,
symlinks, unsafe parent directories, and live routers are never replaced. Socket permissions
are 0600 and newly created parent directories 0700. Frame size is capped at 8 MiB; partial
frames and requests time out. Listener errors are reported to the plugin logger.
