import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentCatalogEntry } from "./types";

const CATALOG_FILE = "agents.json";
const CATALOG_VERSION = 1;

interface CatalogDocument {
	v: number;
	agents: AgentCatalogEntry[];
}

function catalogPath(agentsDir: string): string {
	return join(agentsDir, CATALOG_FILE);
}

function isLaunchable(value: unknown): value is AgentCatalogEntry["launch"] {
	if (typeof value !== "object" || value === null) return false;
	const l = value as Record<string, unknown>;
	return (
		typeof l.command === "string" &&
		l.command.length > 0 &&
		Array.isArray(l.args) &&
		l.args.every((a) => typeof a === "string")
	);
}

function isEntry(value: unknown): value is AgentCatalogEntry {
	if (typeof value !== "object" || value === null) return false;
	const e = value as Record<string, unknown>;
	return (
		typeof e.id === "string" &&
		e.id.length > 0 &&
		typeof e.name === "string" &&
		(e.origin === "installed" || e.origin === "external" || e.origin === "bundled") &&
		isLaunchable(e.launch)
	);
}

export async function readAgentCatalog(agentsDir: string): Promise<AgentCatalogEntry[]> {
	let raw: string;
	try {
		raw = await readFile(catalogPath(agentsDir), "utf8");
	} catch {
		return [];
	}
	let doc: unknown;
	try {
		doc = JSON.parse(raw);
	} catch {
		return [];
	}
	if (typeof doc !== "object" || doc === null) return [];
	const agents = (doc as Partial<CatalogDocument>).agents;
	if (!Array.isArray(agents)) return [];
	return agents.filter(isEntry);
}

async function writeAgentCatalog(agentsDir: string, agents: AgentCatalogEntry[]): Promise<void> {
	await mkdir(agentsDir, { recursive: true });
	const doc: CatalogDocument = { v: CATALOG_VERSION, agents };
	const tmp = `${catalogPath(agentsDir)}.${process.pid}.tmp`;
	await writeFile(tmp, `${JSON.stringify(doc, null, "\t")}\n`, "utf8");
	try {
		await rename(tmp, catalogPath(agentsDir));
	} catch (error) {
		await rm(tmp, { force: true });
		throw error;
	}
}

export async function recordAgent(
	agentsDir: string,
	entry: AgentCatalogEntry,
): Promise<AgentCatalogEntry[]> {
	const agents = await readAgentCatalog(agentsDir);
	const next = [...agents.filter((a) => a.id !== entry.id), entry];
	await writeAgentCatalog(agentsDir, next);
	return next;
}

export async function forgetAgent(
	agentsDir: string,
	agentId: string,
): Promise<AgentCatalogEntry[]> {
	const agents = await readAgentCatalog(agentsDir);
	const going = agents.find((a) => a.id === agentId);
	const next = agents.filter((a) => a.id !== agentId);
	await writeAgentCatalog(agentsDir, next);
	if (going?.dir !== undefined) await rm(going.dir, { recursive: true, force: true });
	return next;
}
