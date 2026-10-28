import { dirnamePath, joinPath, type TabFs } from "./fs";
import type { NodeRunRequest, NodeRunResult } from "./runtime/runtime";

export const NODE_TIMEOUT_MS = 5 * 60_000;

/** Every file under `roots`, `.git` excluded, as the copy a `node` run works on. */
function snapshot(fs: TabFs, roots: readonly string[]): Record<string, Uint8Array> {
	const files: Record<string, Uint8Array> = {};
	const walk = (dir: string) => {
		if (!fs.existsSync(dir)) return;
		for (const name of fs.readdirSync(dir) as string[]) {
			if (name === ".git") continue;
			const child = joinPath(dir, name);
			if (fs.statSync(child).isDirectory()) walk(child);
			else files[child] = fs.readFileSync(child) as Uint8Array;
		}
	};
	for (const root of roots) walk(root);
	return files;
}

export interface NodeRun {
	roots: readonly string[];
	cwd: string;
	env: Record<string, string>;
	entry?: string;
	code?: string;
	print?: boolean;
	args: string[];
	stdin?: string;
	timeoutMs?: number;
}

/**
 * Runs `node` in a nested worker on a copy of `roots`, never in the tab host itself: the host's state and
 * credentials stay out of reach, and a run that does not finish is terminated. Writes come back after it exits.
 */
export async function runNodeIsolated(fs: TabFs, run: NodeRun): Promise<NodeRunResult> {
	const worker = new Worker(new URL("./runtime/worker.ts", import.meta.url), {
		type: "module",
		name: "thinkrail-node",
	});
	const request: NodeRunRequest = {
		files: snapshot(fs, run.roots),
		cwd: run.cwd,
		env: run.env,
		args: run.args,
		stdin: run.stdin ?? "",
		...(run.entry !== undefined ? { entry: run.entry } : {}),
		...(run.code !== undefined ? { code: run.code } : {}),
		...(run.print ? { print: true } : {}),
	};
	const timeoutMs = run.timeoutMs ?? NODE_TIMEOUT_MS;
	try {
		const outcome = await new Promise<{ result?: NodeRunResult; error?: string }>((resolve) => {
			const timer = setTimeout(
				() => resolve({ error: `node: terminated after ${timeoutMs / 1000}s` }),
				timeoutMs,
			);
			worker.onmessage = (event: MessageEvent<{ result?: NodeRunResult; error?: string }>) => {
				clearTimeout(timer);
				resolve(event.data);
			};
			worker.onerror = (event) => {
				clearTimeout(timer);
				resolve({ error: event.message });
			};
			worker.postMessage(request);
		});
		if (!outcome.result)
			return {
				stdout: "",
				stderr: `${outcome.error ?? "node failed"}\n`,
				exitCode: 1,
				changes: {},
			};
		for (const [file, bytes] of Object.entries(outcome.result.changes)) {
			if (!run.roots.some((root) => file === root || file.startsWith(`${root}/`))) continue;
			if (bytes === null) fs.rmSync(file, { force: true });
			else {
				fs.mkdirSync(dirnamePath(file), { recursive: true });
				fs.writeFileSync(file, bytes);
			}
		}
		return outcome.result;
	} finally {
		worker.terminate();
	}
}
