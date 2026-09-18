export interface ProcessSnapshot {
	childrenOf(pid: number): number[];
	parentOf(pid: number): number | null;
	nameOf(pid: number): string | null;
}

export interface ProcessRow {
	pid: number;
	ppid: number;
	name: string;
}

export const WINDOWS_PROCESS_LIST = [
	"$ErrorActionPreference = 'Stop'",
	'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }',
].join("; ");

function baseName(command: string): string {
	const cut = command.lastIndexOf("/");
	const name = cut === -1 ? command : command.slice(cut + 1);
	return name.replace(/\.exe$/i, "");
}

export function parseProcessRows(output: string): ProcessRow[] {
	const rows: ProcessRow[] = [];
	for (const line of output.split("\n")) {
		const match = /^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(line);
		if (!match) continue;
		const pid = Number.parseInt(match[1] ?? "", 10);
		const ppid = Number.parseInt(match[2] ?? "", 10);
		if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
		rows.push({ pid, ppid, name: baseName(match[3] ?? "") });
	}
	return rows;
}

export function snapshotFromRows(rows: readonly ProcessRow[]): ProcessSnapshot {
	const children = new Map<number, number[]>();
	const parents = new Map<number, number>();
	const names = new Map<number, string>();
	for (const row of rows) {
		names.set(row.pid, row.name);
		parents.set(row.pid, row.ppid);
		const siblings = children.get(row.ppid);
		if (siblings) siblings.push(row.pid);
		else children.set(row.ppid, [row.pid]);
	}
	return {
		childrenOf: (pid) => children.get(pid) ?? [],
		parentOf: (pid) => parents.get(pid) ?? null,
		nameOf: (pid) => names.get(pid) ?? null,
	};
}

function listProcesses(): string | null {
	const command =
		process.platform === "win32"
			? ["powershell.exe", "-NoProfile", "-Command", WINDOWS_PROCESS_LIST]
			: ["ps", "-Ao", "pid=,ppid=,comm="];
	try {
		const run = Bun.spawnSync(command, { stdout: "pipe", stderr: "ignore" });
		return run.exitCode === 0 ? run.stdout.toString() : null;
	} catch {
		return null;
	}
}

export function captureProcessSnapshot(): ProcessSnapshot | null {
	const output = listProcesses();
	return output === null ? null : snapshotFromRows(parseProcessRows(output));
}

export const MAX_DESCENDANT_DEPTH = 4;

export function findDescendantProcess<T extends string>(
	snapshot: ProcessSnapshot,
	rootPid: number,
	wanted: readonly T[],
	maxDepth: number = MAX_DESCENDANT_DEPTH,
): { pid: number; name: T } | null {
	const want = new Set<string>(wanted);
	const seen = new Set<number>([rootPid]);
	let frontier = [rootPid];
	for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
		const next: number[] = [];
		for (const pid of frontier) {
			for (const child of snapshot.childrenOf(pid)) {
				if (seen.has(child)) continue;
				seen.add(child);
				const name = snapshot.nameOf(child);
				if (name !== null && want.has(name)) return { pid: child, name: name as T };
				next.push(child);
			}
		}
		frontier = next;
	}
	return null;
}

/** Whether this tab's `self` agent was started by its `outer` one, the tab's own agent — see SPEC.md. */
export function runsInsideAgent(
	snapshot: ProcessSnapshot,
	rootPid: number,
	self: string,
	outer: string,
): boolean {
	const found = findDescendantProcess(snapshot, rootPid, [self]);
	let pid = found ? snapshot.parentOf(found.pid) : null;
	for (let depth = 0; pid !== null && pid !== rootPid && depth < MAX_DESCENDANT_DEPTH; depth++) {
		if (snapshot.nameOf(pid) === outer) return true;
		pid = snapshot.parentOf(pid);
	}
	return false;
}
