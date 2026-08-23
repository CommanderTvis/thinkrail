import { randomUUID } from "node:crypto";
import type {
	IdeActionKind,
	IdeActionParams,
	IdeActionReply,
	IdeActionRequest,
	IdeDocumentClosed,
	IdeSelectionChanged,
} from "@thinkrail/contracts";
import { findFreePort } from "@thinkrail/shared/freePort";
import { removeLockFile, removeOwnStaleLocks, writeLockFile } from "./lockFile";
import {
	failure,
	IDE_AUTH_HEADER,
	IDE_TOOLS,
	JSON_RPC_INTERNAL_ERROR,
	JSON_RPC_METHOD_NOT_FOUND,
	MCP_PROTOCOL_VERSION,
	notification,
	parseJsonRpc,
	success,
	toolContent,
} from "./mcp";

export const IDE_NAME = "ThinkRail";

/** The env var the CLI reads to skip lock-file discovery entirely when we spawned its terminal. */
export const SSE_PORT_ENV = "CLAUDE_CODE_SSE_PORT";

const ACTION_TIMEOUT_MS = 15_000;
const PORT_SCAN_START = 10_100;

type ActionDispatcher = (request: IdeActionRequest) => void;

export interface IdeBridgeDeps {
	/** Pushes a host-initiated action to the workspace's clients; the reply arrives via `settleAction`. */
	dispatch: ActionDispatcher;
	listWorkspaceFolders: () => string[];
}

interface Socket {
	send(data: string): void;
	close(code?: number, reason?: string): void;
}

interface Bridge {
	port: number;
	authToken: string;
	stop(): Promise<void>;
}

let bridge: Bridge | null = null;
let deps: IdeBridgeDeps | null = null;
const clients = new Set<Socket>();

/** The last *non-empty* selection seen, kept after focus moves away — `getLatestSelection`'s whole purpose. */
let latestSelection: IdeSelectionChanged | null = null;
let currentSelection: IdeSelectionChanged | null = null;

const pending = new Map<
	string,
	{
		resolve: (value: unknown) => void;
		reject: (err: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}
>();

export function setIdeBridgeDeps(next: IdeBridgeDeps | null): void {
	deps = next;
}

export function ideBridgePort(): number | null {
	return bridge?.port ?? null;
}

function requestAction(
	workspaceId: string,
	kind: IdeActionKind,
	params: IdeActionParams,
): Promise<unknown> {
	const dispatch = deps?.dispatch;
	if (!dispatch) return Promise.reject(new Error("No ThinkRail client is connected"));
	const id = randomUUID();
	return new Promise<unknown>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`The editor did not answer ${kind} in time`));
		}, ACTION_TIMEOUT_MS);
		pending.set(id, { resolve, reject, timer });
		dispatch({ id, workspaceId, kind, params });
	});
}

/** Called by the host when a client answers a dispatched action. Unknown/late ids are dropped. */
export function settleAction(reply: IdeActionReply): void {
	const entry = pending.get(reply.id);
	if (!entry) return;
	pending.delete(reply.id);
	clearTimeout(entry.timer);
	if (reply.result.ok) entry.resolve(reply.result.value);
	else entry.reject(new Error(reply.result.error));
}

function broadcast(message: string): void {
	for (const socket of clients) socket.send(message);
}

export function applySelectionChanged(payload: IdeSelectionChanged): void {
	currentSelection = payload;
	if (payload.text !== "") latestSelection = payload;
	broadcast(
		notification("selection_changed", {
			text: payload.text,
			filePath: payload.path,
			fileUrl: `file://${payload.path}`,
			selection: {
				start: { line: payload.selection.startLine, character: payload.selection.startColumn },
				end: { line: payload.selection.endLine, character: payload.selection.endColumn },
			},
		}),
	);
}

export function applyDocumentClosed(payload: IdeDocumentClosed): void {
	if (currentSelection?.path === payload.path) currentSelection = null;
	broadcast(
		notification("document_closed", { filePath: payload.path, uri: `file://${payload.path}` }),
	);
}

function selectionPayload(value: IdeSelectionChanged | null): unknown {
	if (!value) return { success: false, message: "No selection" };
	return {
		success: true,
		text: value.text,
		filePath: value.path,
		fileUrl: `file://${value.path}`,
		selection: {
			start: { line: value.selection.startLine, character: value.selection.startColumn },
			end: { line: value.selection.endLine, character: value.selection.endColumn },
		},
	};
}

function workspaceOf(value: IdeSelectionChanged | null): string | null {
	return value?.workspaceId ?? null;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
	// Every write-side tool needs a workspace to act in; the CLI never sends one, so the bridge infers it
	// from the selection it last saw. See SPEC.md.
	const workspaceId = workspaceOf(currentSelection ?? latestSelection);
	const needsWorkspace = (): string => {
		if (!workspaceId) throw new Error("No active ThinkRail workspace for this request");
		return workspaceId;
	};

	switch (name) {
		case "getCurrentSelection":
			return selectionPayload(currentSelection);
		case "getLatestSelection":
			return selectionPayload(latestSelection);
		case "getWorkspaceFolders": {
			const folders = deps?.listWorkspaceFolders() ?? [];
			return { folders: folders.map((path) => ({ name: path.split("/").pop() ?? path, path })) };
		}
		case "openFile":
			return requestAction(needsWorkspace(), "openFile", {
				path: String(args.filePath ?? ""),
				...(args.preview === undefined ? {} : { preview: args.preview === true }),
				...(typeof args.startText === "string" ? { startText: args.startText } : {}),
				...(typeof args.endText === "string" ? { endText: args.endText } : {}),
			});
		case "openDiff":
			return requestAction(needsWorkspace(), "openDiff", {
				...(typeof args.old_file_path === "string" ? { oldPath: args.old_file_path } : {}),
				...(typeof args.new_file_path === "string" ? { newPath: args.new_file_path } : {}),
				...(typeof args.new_file_contents === "string"
					? { newContent: args.new_file_contents }
					: {}),
			});
		case "getOpenEditors":
			return requestAction(needsWorkspace(), "getOpenEditors", {});
		case "checkDocumentDirty":
			return requestAction(needsWorkspace(), "checkDocumentDirty", {
				path: String(args.filePath ?? ""),
			});
		case "saveDocument":
			return requestAction(needsWorkspace(), "saveDocument", {
				path: String(args.filePath ?? ""),
			});
		case "close_tab":
			return requestAction(needsWorkspace(), "closeTab", { tabName: String(args.tab_name ?? "") });
		case "closeAllDiffTabs":
			return requestAction(needsWorkspace(), "closeAllDiffTabs", {});
		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}

async function handleMessage(socket: Socket, raw: string): Promise<void> {
	const message = parseJsonRpc(raw);
	if (!message) return;
	const { id, method } = message;
	// A notification (no id) is never answered, even when we do not recognise it.
	if (id === undefined) return;

	try {
		if (method === "initialize") {
			socket.send(
				success(id, {
					protocolVersion: MCP_PROTOCOL_VERSION,
					capabilities: { tools: {} },
					serverInfo: { name: "thinkrail-ide", version: "1.0.0" },
				}),
			);
			return;
		}
		if (method === "tools/list") {
			socket.send(success(id, { tools: IDE_TOOLS }));
			return;
		}
		if (method === "ping") {
			socket.send(success(id, {}));
			return;
		}
		if (method === "tools/call") {
			const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
			const name = typeof params.name === "string" ? params.name : "";
			const args =
				typeof params.arguments === "object" && params.arguments !== null
					? (params.arguments as Record<string, unknown>)
					: {};
			socket.send(success(id, toolContent(await callTool(name, args))));
			return;
		}
		socket.send(failure(id, JSON_RPC_METHOD_NOT_FOUND, `Unknown method: ${method}`));
	} catch (err) {
		socket.send(
			failure(id, JSON_RPC_INTERNAL_ERROR, err instanceof Error ? err.message : String(err)),
		);
	}
}

export async function startIdeBridge(): Promise<{ port: number } | null> {
	if (bridge) return { port: bridge.port };
	removeOwnStaleLocks(IDE_NAME);

	const authToken = randomUUID();
	const port = await findFreePort(PORT_SCAN_START);

	const server = Bun.serve<{ authorized: boolean }, never>({
		port,
		hostname: "127.0.0.1",
		fetch(req, srv) {
			if (req.headers.get(IDE_AUTH_HEADER) !== authToken) {
				return new Response("unauthorized", { status: 401 });
			}
			return srv.upgrade(req, { data: { authorized: true } })
				? undefined
				: new Response("ws upgrade failed", { status: 400 });
		},
		websocket: {
			open(ws) {
				clients.add(ws as unknown as Socket);
			},
			message(ws, data) {
				void handleMessage(
					ws as unknown as Socket,
					typeof data === "string" ? data : data.toString(),
				);
			},
			close(ws) {
				clients.delete(ws as unknown as Socket);
			},
		},
	});

	writeLockFile(port, {
		pid: process.pid,
		workspaceFolders: deps?.listWorkspaceFolders() ?? [],
		ideName: IDE_NAME,
		transport: "ws",
		runningInWindows: process.platform === "win32",
		authToken,
	});

	bridge = {
		port,
		authToken,
		async stop() {
			removeLockFile(port);
			clients.clear();
			for (const entry of pending.values()) {
				clearTimeout(entry.timer);
				entry.reject(new Error("The IDE bridge stopped"));
			}
			pending.clear();
			currentSelection = null;
			latestSelection = null;
			server.stop(true);
		},
	};
	return { port };
}

/** Re-publishes the lock file's workspace list after a workspace is opened or archived. */
export function refreshIdeBridgeWorkspaces(): void {
	if (!bridge) return;
	writeLockFile(bridge.port, {
		pid: process.pid,
		workspaceFolders: deps?.listWorkspaceFolders() ?? [],
		ideName: IDE_NAME,
		transport: "ws",
		runningInWindows: process.platform === "win32",
		authToken: bridge.authToken,
	});
}

export async function stopIdeBridge(): Promise<void> {
	const running = bridge;
	bridge = null;
	await running?.stop();
}

/**
 * The tool dispatch and the module-level selection state, reachable without standing up a real socket —
 * the protocol framing is pinned in mcp.test.ts, and this is what pins the behaviour behind it.
 */
export const __testing = {
	callTool,
	reset(): void {
		for (const entry of pending.values()) clearTimeout(entry.timer);
		pending.clear();
		currentSelection = null;
		latestSelection = null;
		clients.clear();
	},
};
