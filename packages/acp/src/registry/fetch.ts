import type { AgentDistribution, AgentRegistryEntry } from "@thinkrail/contracts";
import { ACP_REGISTRY_URL } from "./types";

export type FetchLike = (
	url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface RegistryFetchResult {
	entries: AgentRegistryEntry[];
	stale: boolean;
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function strArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out = value.filter((v): v is string => typeof v === "string");
	return out.length === value.length ? out : undefined;
}

function strRecord(value: unknown): Record<string, string> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(value)) {
		if (typeof v !== "string") return undefined;
		out[k] = v;
	}
	return out;
}

export function platformCandidates(platform: string, arch: string): string[] {
	const os =
		platform === "darwin"
			? ["darwin", "macos"]
			: platform === "win32"
				? ["windows", "win32"]
				: [platform];
	const cpu =
		arch === "arm64" ? ["aarch64", "arm64"] : arch === "x64" ? ["x86_64", "x64", "amd64"] : [arch];
	const keys: string[] = [];
	for (const o of os) for (const c of cpu) keys.push(`${o}-${c}`);
	return keys;
}

function parseDistribution(raw: unknown, candidates: string[]): AgentDistribution | null {
	if (typeof raw !== "object" || raw === null) return null;
	const dist = raw as Record<string, unknown>;

	const binary = dist.binary;
	if (typeof binary === "object" && binary !== null) {
		const builds = binary as Record<string, unknown>;
		for (const key of candidates) {
			const build = builds[key];
			if (typeof build !== "object" || build === null) continue;
			const b = build as Record<string, unknown>;
			const archive = str(b.archive);
			const command = str(b.cmd);
			if (archive === undefined || command === undefined) continue;
			const args = strArray(b.args) ?? [];
			const env = strRecord(b.env);
			const sha256 = str(b.sha256);
			return {
				kind: "binary",
				archive,
				command,
				args,
				...(env === undefined ? {} : { env }),
				...(sha256 === undefined ? {} : { sha256 }),
			};
		}
	}

	for (const kind of ["npx", "uvx"] as const) {
		const run = dist[kind];
		if (typeof run !== "object" || run === null) continue;
		const r = run as Record<string, unknown>;
		const pkg = str(r.package);
		if (pkg === undefined) continue;
		const args = strArray(r.args);
		const env = strRecord(r.env);
		const common = {
			package: pkg,
			...(args === undefined ? {} : { args }),
			...(env === undefined ? {} : { env }),
		};
		return kind === "npx" ? { kind: "npx", ...common } : { kind: "uvx", ...common };
	}
	return null;
}

export function parseRegistryDocument(
	doc: unknown,
	platform: string,
	arch: string,
): AgentRegistryEntry[] {
	if (typeof doc !== "object" || doc === null) return [];
	const agents = (doc as Record<string, unknown>).agents;
	if (!Array.isArray(agents)) return [];

	const candidates = platformCandidates(platform, arch);
	const out: AgentRegistryEntry[] = [];
	const seen = new Set<string>();
	for (const raw of agents) {
		if (typeof raw !== "object" || raw === null) continue;
		const a = raw as Record<string, unknown>;
		const id = str(a.id);
		const name = str(a.name);
		const version = str(a.version);
		if (id === undefined || name === undefined || version === undefined) continue;
		if (seen.has(id)) continue;
		seen.add(id);
		const distribution = parseDistribution(a.distribution, candidates);
		const description = str(a.description);
		const repository = str(a.repository);
		const license = str(a.license);
		const icon = str(a.icon);
		const authors = strArray(a.authors);
		out.push({
			id,
			name,
			version,
			distribution,
			installed: false,
			...(description === undefined ? {} : { description }),
			...(repository === undefined ? {} : { repository }),
			...(license === undefined ? {} : { license }),
			...(icon === undefined ? {} : { icon }),
			...(authors === undefined ? {} : { authors }),
		});
	}
	return out;
}

export async function fetchRegistry(options: {
	fetchImpl: FetchLike;
	platform: string;
	arch: string;
	cached?: AgentRegistryEntry[];
	url?: string;
}): Promise<RegistryFetchResult> {
	const cached = options.cached ?? [];
	try {
		const response = await options.fetchImpl(options.url ?? ACP_REGISTRY_URL);
		if (!response.ok) return { entries: cached, stale: true };
		const entries = parseRegistryDocument(await response.json(), options.platform, options.arch);
		return entries.length === 0 && cached.length > 0
			? { entries: cached, stale: true }
			: { entries, stale: false };
	} catch {
		return { entries: cached, stale: true };
	}
}
