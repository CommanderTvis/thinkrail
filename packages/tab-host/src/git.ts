import type { BranchList, GitCommit, GitFileChange, GitStatus } from "@thinkrail/contracts";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { joinPath, type TabFs } from "./fs";

/** Where a clone records the CORS proxy it came through, so later pulls and pushes use it too. */
export const CORS_PROXY_CONFIG = "http.corsProxy";

export const TAB_AUTHOR = { name: "ThinkRail tab", email: "tab@thinkrail.invalid" };

export async function isRepo(fs: TabFs, dir: string): Promise<boolean> {
	return fs.existsSync(joinPath(dir, ".git"));
}

export async function hasCommits(fs: TabFs, dir: string): Promise<boolean> {
	return git.resolveRef({ fs, dir, ref: "HEAD" }).then(
		() => true,
		() => false,
	);
}

export async function currentBranch(fs: TabFs, dir: string): Promise<string> {
	return (await git.currentBranch({ fs, dir, fullname: false }).catch(() => undefined)) ?? "HEAD";
}

export async function status(fs: TabFs, dir: string): Promise<GitStatus> {
	const rows = await git.statusMatrix({ fs, dir });
	const changes: GitFileChange[] = [];
	for (const [path, head, workdir, stage] of rows) {
		if (head === 1 && workdir === 1 && stage === 1) continue;
		if (head === 0) changes.push({ path, status: stage === 0 ? "untracked" : "added" });
		else if (workdir === 0) changes.push({ path, status: "deleted" });
		else changes.push({ path, status: "modified" });
	}
	return { branch: await currentBranch(fs, dir), changes };
}

export async function headText(
	fs: TabFs,
	dir: string,
	path: string,
): Promise<{ text: string; oid: string | null }> {
	try {
		const oid = await git.resolveRef({ fs, dir, ref: "HEAD" });
		const { blob, oid: blobOid } = await git.readBlob({ fs, dir, oid, filepath: path });
		return { text: new TextDecoder().decode(blob), oid: blobOid };
	} catch {
		return { text: "", oid: null };
	}
}

export async function readBlob(fs: TabFs, dir: string, oid: string): Promise<Uint8Array> {
	return (await git.readBlob({ fs, dir, oid })).blob;
}

export async function listCommits(fs: TabFs, dir: string, depth = 100): Promise<GitCommit[]> {
	const commits = await git.log({ fs, dir, depth }).catch(() => []);
	return commits.map(({ oid, commit }) => ({
		sha: oid,
		shortSha: oid.slice(0, 7),
		subject: commit.message.split("\n")[0] ?? "",
		author: commit.author.name,
		committedAt: new Date(commit.committer.timestamp * 1000).toISOString(),
	}));
}

export async function listBranches(fs: TabFs, dir: string): Promise<BranchList> {
	const local: string[] = await git.listBranches({ fs, dir }).catch(() => []);
	const remote = (await git.listBranches({ fs, dir, remote: "origin" }).catch(() => []))
		.filter((name) => name !== "HEAD")
		.map((name) => `origin/${name}`);
	const current = await currentBranch(fs, dir);
	const defaultBranch = local.includes("main")
		? "main"
		: local.includes("master")
			? "master"
			: current;
	return { local, remote, defaultBranch, current };
}

export async function commitAll(fs: TabFs, dir: string, message: string): Promise<string> {
	for (const [path, , workdir] of await git.statusMatrix({ fs, dir })) {
		if (workdir === 0) await git.remove({ fs, dir, filepath: path });
		else await git.add({ fs, dir, filepath: path });
	}
	return git.commit({ fs, dir, message, author: TAB_AUTHOR });
}

export async function init(fs: TabFs, dir: string): Promise<void> {
	await git.init({ fs, dir, defaultBranch: "main" });
}

export interface CloneOptions {
	url: string;
	dir: string;
	corsProxy: string;
	depth?: number;
	onProgress?: (message: string) => void;
}

export async function clone(fs: TabFs, options: CloneOptions): Promise<void> {
	await git.clone({
		fs,
		http,
		dir: options.dir,
		url: options.url,
		...(options.corsProxy ? { corsProxy: options.corsProxy } : {}),
		singleBranch: true,
		...(options.depth !== undefined ? { depth: options.depth } : {}),
		onProgress: (event) =>
			options.onProgress?.(
				event.total
					? `${event.phase} ${event.loaded}/${event.total}`
					: `${event.phase} ${event.loaded}`,
			),
	});
	if (options.corsProxy)
		await git.setConfig({
			fs,
			dir: options.dir,
			path: CORS_PROXY_CONFIG,
			value: options.corsProxy,
		});
}
