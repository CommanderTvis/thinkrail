---
id: submodule-acp-client
type: submodule-design
status: draft
title: client — the methods the agent calls back into
parent: module-acp
depends-on: [module-contracts]
covers: [client-side-delegation, thinkrail-as-mcp-server]
tags: [v1, acp]
---

## Responsibility

Every ACP method whose handler lives on the client side — `session/update`,
`session/request_permission`, `fs/read_text_file`, `fs/write_text_file`, the five `terminal/*`,
`elicitation/create`, `elicitation/complete`, and the three `mcp/*` that carry an `McpServerAcp` —
implemented over **injected callbacks**, so this package never learns what a worktree, a PTY or a tool
is.

## Boundary

- **Owns:** the handler registrations, the translation each way, the error mapping from a host exception
  to a JSON-RPC error, and the `McpServerAcp` connection table.
- **Public surface (barrel):** `registerClientHandlers`, `AcpClientDelegates`, `AcpClientRuntime`,
  `McpEndpoint`, and the plain request/response types the delegates take.
- **Allowed deps:** `@agentclientprotocol/sdk`, `@thinkrail/contracts` (types), sibling `translate`.
- **Forbidden:** sibling `connection` — it declares the runtime interface it needs and `connection`
  implements it, which is what keeps the graph acyclic; the host; the filesystem; any process.

## Pinned surface

```ts
export interface AcpClientDelegates {
	readTextFile(r: { sessionId: string; path: string; line?: number; limit?: number }): Promise<string>
	writeTextFile(r: { sessionId: string; path: string; content: string }): Promise<void>
	createTerminal(r: TerminalCreateRequest): Promise<string>
	terminalOutput(sessionId: string, terminalId: string): Promise<TerminalOutput>
	waitForTerminalExit(sessionId: string, terminalId: string): Promise<TerminalExit>
	killTerminal(sessionId: string, terminalId: string): Promise<void>
	releaseTerminal(sessionId: string, terminalId: string): Promise<void>
	requestPermission(request: PermissionRequest): Promise<PermissionDecision>
	createElicitation(request: ElicitationRequest): Promise<ElicitationResponse>
	completeElicitation(id: string): void
	publish(sessionId: string, events: ChatEvent[]): void
	openMcpEndpoint(serverId: string): Promise<McpEndpoint>
}

export interface McpEndpoint {
	request(method: string, params?: Record<string, unknown>): Promise<unknown>
	notify(method: string, params?: Record<string, unknown>): void
	close(): void
}

export interface AcpClientRuntime {
	applyUpdate(notification: SessionNotification): void
	nextId(): string
	readonly signal: AbortSignal
}

export function registerClientHandlers(
	app: ClientApp,
	delegates: AcpClientDelegates,
	runtime: AcpClientRuntime,
): ClientApp
```

What the shapes above do not say on their own:

- `TerminalCreateRequest` is ACP's terminal shapes already flattened: `cwd` is the absolute path the
  agent chose and absent means the session's own worktree; `outputByteLimit` is how many bytes of output
  to retain, and the host truncates from the front once it is exceeded.
- `TerminalExit`'s two fields are both `null` when the host cannot say how a command ended;
  `TerminalOutput.exit` is absent while the command is still running.
- `McpEndpoint` is one MCP server the host exposes over the ACP connection itself ([[architecture]]
  Decision #17): `request` answers an inner MCP request with its MCP result, `notify` takes an inner
  notification, which has no reply, and `close` releases whatever the host allocated for it.
- `publish` is the transcript + wire sink: one batch per ACP notification.
- `AcpClientRuntime` is what the handlers need from whatever owns the process, and `connection`
  implements it. `applyUpdate` **must be synchronous** — see [[module-acp]]'s invariant.

## Decisions

- **`createTerminal` returns the workspace tab key.** One string serves as the ACP terminal id and as the
  key the client passes to `terminal.attach`, which removes the id→tab mapping table the wire would
  otherwise need. Corollary (Decision #9): agent-spawned shells appear as user-visible tabs.
- **Every request handler wraps its delegate.** A host exception becomes a JSON-RPC error response; an
  unhandled rejection here would tear the connection down mid-turn and lose the rest of the answer. The
  two *notifications* are left unwrapped: they have no error channel to convert a throw into, and the
  SDK's own notification path already keeps one bad frame from closing the connection.
- **`session/update` is the one handler that only routes.** It hands the notification straight to
  `AcpClientRuntime.applyUpdate`, because the two things that happen alongside assembly — widening the
  capability record by observation, and diverting a `session/load` replay away from the live sink — are
  the connection's, and neither is knowable from here.
- **Prompts, form elicitations and MCP connections take their ids from the runtime's clock.** ACP
  correlates all three by JSON-RPC request id, which nothing outside this package can hold, while the
  wire routes an answer back by an id the browser can carry. One id authority, no second generator.
- **An unrenderable elicitation is declined, not dropped** — the schema forbids rendering an unknown
  mode as a known one, and a blocked agent is a hung turn.
- **`fs/*` and `terminal/*` are advertised unconditionally.** ACP v2 removes both; when it does, this
  module loses two handler groups and nothing else in the repo moves.
- **MCP connections are torn down with the agent.** `mcp/disconnect` and connection close both release
  the endpoint, so no endpoint outlives the process that asked for it.
- **`mcp/*` is the whole of the transport and the connection table is the whole of the state.**
  `mcp/connect` opens a host endpoint and names it, `mcp/message` carries one inner MCP message each way,
  `mcp/disconnect` releases it. Nothing here knows what an MCP server does.
- **`mcp/*` is registered with hand-written `ParamsParser` functions.** The SDK types only the spec'd
  client methods; a plain validating function satisfies the interface and keeps a schema library out of
  this module's own surface. `mcp/message` arrives as both a request and a notification, and one params
  shape serves both.
- **An MCP result of `undefined` answers `{}`.** JSON-RPC has no "no result" response, and an MCP result
  is always an object.
- **Teardown never faults.** Disconnecting twice is answered rather than rejected, and a notification for
  a connection we no longer hold is dropped — it has nowhere to report.
