import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { PluginHostContext } from "@thinkrail/plugin-api/host";
import type { CodexIdeContext, codexContract } from "../contracts";
import { codexHome } from "./config";
import { startIdeBridge } from "./ideBridge";

function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function socketPath(): string {
	if (process.platform === "win32") return "\\\\.\\pipe\\codex-ipc";
	const primary = join(codexHome(), "ipc", "ipc.sock");
	const uid = process.getuid?.() ?? 0;
	const legacy = join(tmpdir(), "codex-ipc", uid ? `ipc-${uid}.sock` : "ipc.sock");
	return !process.env.CODEX_HOME && !existsSync(primary) && existsSync(legacy) ? legacy : primary;
}

export function registerIdeContext(ctx: PluginHostContext<typeof codexContract>): () => void {
	const pending = new Map<
		string,
		{
			workspaceId: string;
			complete: (context: CodexIdeContext | null) => void;
			fallback: CodexIdeContext | null;
		}
	>();
	const workspace = (root: string) => {
		const cwd = canonical(root);
		return ctx
			.workspaces()
			.map((item) => ({ item, path: canonical(item.worktreePath) }))
			.filter(({ path }) => cwd === path || cwd.startsWith(path + sep))
			.sort((a, b) => b.path.length - a.path.length)[0]?.item;
	};
	ctx.method("ideReply", (reply) => {
		const request = pending.get(reply.requestId);
		if (request?.workspaceId === reply.workspaceId) {
			if (reply.focused) request.complete(reply.context);
			else request.fallback = reply.context;
		}
		return null;
	});
	const stop = startIdeBridge({
		path: socketPath(),
		canHandle: (root) => workspace(root) !== undefined,
		context: (root) =>
			new Promise<CodexIdeContext>((resolveContext, reject) => {
				const target = workspace(root);
				if (!target) {
					reject(new Error("Unknown workspace"));
					return;
				}
				const requestId = randomUUID();
				const cwd = canonical(root);
				const worktree = canonical(target.worktreePath);
				const pathFor = (path: string) =>
					isAbsolute(path) ? path : relative(cwd, resolve(worktree, path));
				const complete = (context: CodexIdeContext | null) => {
					clearTimeout(timer);
					pending.delete(requestId);
					if (context)
						resolveContext({
							openTabs: context.openTabs.map((file) => ({ ...file, path: pathFor(file.path) })),
							activeFile: context.activeFile
								? { ...context.activeFile, path: pathFor(context.activeFile.path) }
								: null,
						});
					else reject(new Error("No ThinkRail frontend is connected to this workspace"));
				};
				const timer = setTimeout(() => complete(pending.get(requestId)?.fallback ?? null), 1200);
				pending.set(requestId, { workspaceId: target.id, complete, fallback: null });
				ctx.publish("ideRequest", { requestId, workspaceId: target.id });
			}),
		warn: (error) => ctx.log.warn("Codex IDE context connection failed", { error: String(error) }),
	});
	return () => {
		stop();
		for (const request of pending.values()) request.complete(null);
	};
}
