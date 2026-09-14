import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeHome } from "../claudeConfig";

export interface LockFileContents {
	pid: number;
	workspaceFolders: string[];
	ideName: string;
	transport: "ws";
	runningInWindows: boolean;
	authToken: string;
}

export function ideDir(): string {
	return join(claudeHome(), "ide");
}

export function lockPath(port: number): string {
	return join(ideDir(), `${port}.lock`);
}

export function writeLockFile(port: number, contents: LockFileContents): void {
	mkdirSync(ideDir(), { recursive: true, mode: 0o700 });
	writeFileSync(lockPath(port), JSON.stringify(contents), { encoding: "utf8", mode: 0o600 });
}

export function removeLockFile(port: number): void {
	rmSync(lockPath(port), { force: true });
}

/**
 * Clears lock files this host wrote in a previous run: a hard kill never runs `stop()`, and a stale file
 * advertising a dead port makes the CLI's discovery scan offer a bridge nothing is listening on. Ours are
 * recognized by `ideName`, so another IDE's lock file on this machine is never touched.
 */
export function removeOwnStaleLocks(ideName: string): void {
	let entries: string[];
	try {
		entries = readdirSync(ideDir());
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.endsWith(".lock")) continue;
		const path = join(ideDir(), entry);
		try {
			const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
			const owner =
				typeof parsed === "object" && parsed !== null
					? (parsed as { ideName?: unknown; pid?: unknown }).ideName
					: undefined;
			if (owner !== ideName) continue;
			const pid = (parsed as { pid?: unknown }).pid;
			if (typeof pid === "number" && pid !== process.pid && isAlive(pid)) continue;
			rmSync(path, { force: true });
		} catch {
			// An unreadable/corrupt lock file is not ours to interpret, and not ours to delete.
		}
	}
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
