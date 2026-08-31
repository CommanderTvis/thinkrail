import { join } from "node:path";
import type { AgentRegistryEntry } from "@thinkrail/contracts";
import type { AgentCatalogEntry, InstallPlan } from "./types";

export function planInstall(entry: AgentRegistryEntry, agentsDir: string): InstallPlan | null {
	const dist = entry.distribution;
	if (dist === null) return null;

	if (dist.kind === "binary") {
		const dir = join(agentsDir, entry.id, entry.version);
		return {
			download: {
				url: dist.archive,
				dir,
				...(dist.sha256 === undefined ? {} : { sha256: dist.sha256 }),
			},
			entry: {
				id: entry.id,
				name: entry.name,
				version: entry.version,
				origin: "installed",
				dir,
				launch: {
					command: join(dir, dist.command),
					args: dist.args,
					...(dist.env === undefined ? {} : { env: dist.env }),
				},
				...(entry.icon === undefined ? {} : { icon: entry.icon }),
			},
		};
	}

	const runner = dist.kind === "npx" ? "npx" : "uvx";
	const runnerArgs = dist.kind === "npx" ? ["-y", dist.package] : [dist.package];
	return {
		download: null,
		entry: {
			id: entry.id,
			name: entry.name,
			version: entry.version,
			origin: "installed",
			launch: {
				command: runner,
				args: [...runnerArgs, ...(dist.args ?? [])],
				...(dist.env === undefined ? {} : { env: dist.env }),
			},
			...(entry.icon === undefined ? {} : { icon: entry.icon }),
		},
	};
}

const DISCOURAGED: { readonly [id: string]: string } = {
	"pi-acp":
		"ThinkRail ships its own pi agent — this adapter drops the tools and can't run chats side by side.",
};

export function markInstalled(
	entries: AgentRegistryEntry[],
	catalog: AgentCatalogEntry[],
): AgentRegistryEntry[] {
	const byId = new Map(catalog.map((e) => [e.id, e]));
	return entries.map((entry) => {
		const caution = DISCOURAGED[entry.id];
		const flagged = caution === undefined ? entry : { ...entry, notRecommended: caution };
		const local = byId.get(entry.id);
		if (local === undefined) return flagged;
		return {
			...flagged,
			installed: true,
			...(local.version === undefined || local.version === entry.version
				? {}
				: { installedVersion: local.version }),
		};
	});
}
