import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstallDownload } from "@thinkrail/acp";
import {
	fetchRegistry,
	markInstalled,
	planInstall,
	readAgentCatalog,
	recordAgent,
} from "@thinkrail/acp";
import type { AgentRegistryEntry, AgentRegistryList, InstalledAgent } from "@thinkrail/contracts";
import { agentsDir, listInstalledAgents } from "../agent";
import { publishAgentCatalogChanged } from "./agentCatalog";

const REGISTRY_TTL_MS = 6 * 60 * 60 * 1000;

let cached: { entries: AgentRegistryEntry[]; at: number } | null = null;

export async function listRegistry(refresh: boolean): Promise<AgentRegistryList> {
	const held = cached;
	const catalog = await readAgentCatalog(agentsDir());
	if (held !== null && !refresh && Date.now() - held.at < REGISTRY_TTL_MS) {
		return { entries: markInstalled(held.entries, catalog), stale: false };
	}
	const result = await fetchRegistry({
		fetchImpl: (url) => fetch(url),
		platform: process.platform,
		arch: process.arch,
		...(held === null ? {} : { cached: held.entries }),
	});
	if (!result.stale) cached = { entries: result.entries, at: Date.now() };
	return { entries: markInstalled(result.entries, catalog), stale: result.stale };
}

export async function installAgent(agentId: string): Promise<InstalledAgent> {
	const { entries } = await listRegistry(false);
	const entry = entries.find((candidate) => candidate.id === agentId);
	if (entry === undefined) throw new Error(`No agent named "${agentId}" is in the ACP registry.`);
	const plan = planInstall(entry, agentsDir());
	if (plan === null) {
		throw new Error(
			`"${agentId}" publishes no distribution ThinkRail can install on this platform.`,
		);
	}
	if (plan.download !== null) await download(plan.download);
	await recordAgent(agentsDir(), plan.entry);
	publishAgentCatalogChanged();
	const installed = (await listInstalledAgents()).find((candidate) => candidate.id === agentId);
	if (installed === undefined) throw new Error(`"${agentId}" did not land in the agent catalog.`);
	return installed;
}

async function download({ url, sha256, dir }: InstallDownload): Promise<void> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Downloading ${url} failed with HTTP ${response.status}.`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (sha256 !== undefined) {
		const actual = createHash("sha256").update(bytes).digest("hex");
		if (actual !== sha256) throw new Error(`Checksum mismatch for ${url}.`);
	}
	const staging = await mkdtemp(join(tmpdir(), "thinkrail-agent-"));
	try {
		const archive = join(staging, "agent-archive");
		await Bun.write(archive, bytes);
		await mkdir(dir, { recursive: true });
		await unpack(archive, dir, url);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function unpack(archive: string, dir: string, url: string): Promise<void> {
	const unzip = url.endsWith(".zip");
	const proc = Bun.spawn(
		unzip ? ["unzip", "-oq", archive, "-d", dir] : ["tar", "-xzf", archive, "-C", dir],
		{ stdout: "ignore", stderr: "pipe" },
	);
	const stderr = await new Response(proc.stderr).text();
	if ((await proc.exited) !== 0) throw new Error(`Unpacking the agent archive failed: ${stderr}`);
}
