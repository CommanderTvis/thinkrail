import semver from "semver";
import { dirnamePath, joinPath, type TabFs } from "./fs";

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const PARALLEL_REQUESTS = 8;
const ATTEMPTS = 3;

/** A bounded pool for registry requests: a big tree would otherwise open hundreds at once and the browser refuses them. */
function limiter(limit: number) {
	let active = 0;
	const waiting: (() => void)[] = [];
	return async <T>(task: () => Promise<T>): Promise<T> => {
		while (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
		active++;
		try {
			return await task();
		} finally {
			active--;
			waiting.shift()?.();
		}
	};
}

async function fetchWithRetry(url: string, what: string, init?: RequestInit): Promise<Response> {
	let last: unknown;
	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		try {
			const response = await fetch(url, init);
			if (response.ok || (response.status >= 400 && response.status < 500)) return response;
			last = new Error(`${response.status} ${response.statusText}`);
		} catch (error) {
			last = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
	}
	const reason = (last as Error).message ?? String(last);
	throw new Error(
		`npm: ${what}: ${reason === "Failed to fetch" ? "not found in the registry, or the registry is unreachable" : reason}`,
	);
}

interface Packument {
	name: string;
	"dist-tags": Record<string, string>;
	versions: Record<string, Manifest>;
}

export interface Manifest {
	name: string;
	version: string;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
	scripts?: Record<string, string>;
	bin?: string | Record<string, string>;
	dist: { tarball: string };
}

export type InstallLog = (line: string) => void;

/** Reads a ustar archive into `{ path: bytes }`, directories implied. */
export function untar(archive: Uint8Array): Map<string, Uint8Array> {
	const files = new Map<string, Uint8Array>();
	const decoder = new TextDecoder();
	const text = (from: number, length: number) =>
		decoder.decode(archive.subarray(from, from + length)).replace(/\0.*$/s, "");
	let offset = 0;
	let longName: string | null = null;
	while (offset + 512 <= archive.length) {
		const name = text(offset, 100);
		if (!name) break;
		const size = Number.parseInt(text(offset + 124, 12).trim() || "0", 8);
		const type = text(offset + 156, 1);
		const prefix = text(offset + 345, 155);
		const body = archive.subarray(offset + 512, offset + 512 + size);
		const full = longName ?? (prefix ? `${prefix}/${name}` : name);
		longName = null;
		if (type === "L") longName = decoder.decode(body).replace(/\0.*$/s, "");
		else if (type === "0" || type === "" || type === "\0") files.set(full, body.slice());
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return files;
}

async function gunzip(bytes: ArrayBuffer): Promise<Uint8Array> {
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function parseSpec(spec: string): { name: string; range: string } {
	const at = spec.lastIndexOf("@");
	if (at > 0) return { name: spec.slice(0, at), range: spec.slice(at + 1) || "latest" };
	return { name: spec, range: "latest" };
}

/** Resolves and installs npm packages straight from the registry into a `node_modules` tree; never runs scripts. */
export class NpmInstaller {
	private readonly packuments = new Map<string, Promise<Packument>>();
	private readonly limit = limiter(PARALLEL_REQUESTS);

	constructor(
		private readonly fs: TabFs,
		private readonly log: InstallLog,
		private readonly registry = DEFAULT_REGISTRY,
	) {}

	private packument(name: string): Promise<Packument> {
		let pending = this.packuments.get(name);
		if (!pending) {
			pending = this.limit(() =>
				fetchWithRetry(`${this.registry.replace(/\/$/, "")}/${name.replace("/", "%2f")}`, name, {
					headers: { accept: "application/vnd.npm.install-v1+json" },
				}),
			).then(async (response) => {
				if (!response.ok)
					throw new Error(`npm: ${name}: ${response.status} ${response.statusText}`);
				return (await response.json()) as Packument;
			});
			this.packuments.set(name, pending);
		}
		return pending;
	}

	async resolve(name: string, range: string): Promise<Manifest> {
		if (range.startsWith("npm:")) {
			const target = parseSpec(range.slice(4));
			return this.resolve(target.name, target.range);
		}
		if (/^(file:|link:|git\+|git:|github:|https?:|workspace:)/.test(range) || range.includes("/"))
			throw new Error(`npm: ${name}@${range}: only registry versions install in the Playground`);
		const packument = await this.packument(name);
		const tagged = packument["dist-tags"][range];
		const version =
			tagged ??
			semver.maxSatisfying(Object.keys(packument.versions), range, { includePrerelease: false }) ??
			semver.maxSatisfying(Object.keys(packument.versions), range, { includePrerelease: true });
		const manifest = version ? packument.versions[version] : undefined;
		if (!manifest) throw new Error(`npm: no version of ${name} matches ${range}`);
		return manifest;
	}

	/**
	 * Installs `wanted` (name → range) under `root/node_modules`, hoisting each package to the top level
	 * unless a different version already sits there. Returns the manifests installed, top-level ones first.
	 */
	async install(
		root: string,
		wanted: Record<string, string>,
		options: { dryRun?: boolean } = {},
	): Promise<Manifest[]> {
		const placed = new Map<string, string>();
		const installed: Manifest[] = [];
		const queue: { name: string; range: string; parent: string }[] = Object.entries(wanted).map(
			([name, range]) => ({ name, range, parent: root }),
		);
		const downloads: Promise<void>[] = [];
		while (queue.length > 0) {
			const batch = queue.splice(0);
			const manifests = await Promise.all(batch.map((item) => this.resolve(item.name, item.range)));
			batch.forEach((item, index) => {
				const manifest = manifests[index];
				if (!manifest) return;
				const topDir = joinPath(root, "node_modules", item.name);
				const top = placed.get(topDir);
				const dir =
					top === undefined || top === manifest.version
						? topDir
						: joinPath(item.parent, "node_modules", item.name);
				if (placed.get(dir) === manifest.version) return;
				placed.set(dir, manifest.version);
				installed.push(manifest);
				if (
					manifest.scripts?.preinstall ||
					manifest.scripts?.install ||
					manifest.scripts?.postinstall
				)
					this.log(`npm warn skipped install scripts of ${manifest.name}@${manifest.version}`);
				if (!options.dryRun) downloads.push(this.extract(manifest, dir));
				const peers = Object.entries(manifest.peerDependencies ?? {}).filter(
					([name]) => !manifest.peerDependenciesMeta?.[name]?.optional,
				);
				for (const [name, range] of [...Object.entries(manifest.dependencies ?? {}), ...peers]) {
					queue.push({ name, range, parent: dir });
				}
			});
		}
		await Promise.all(downloads);
		return installed;
	}

	private async extract(manifest: Manifest, dir: string): Promise<void> {
		const response = await this.limit(() =>
			fetchWithRetry(manifest.dist.tarball, `${manifest.name}@${manifest.version}`),
		);
		if (!response.ok) throw new Error(`npm: ${manifest.name}: tarball ${response.status}`);
		const files = untar(await gunzip(await response.arrayBuffer()));
		this.fs.rmSync(dir, { recursive: true, force: true });
		for (const [entry, bytes] of files) {
			const relative = entry.split("/").slice(1).join("/");
			if (!relative) continue;
			const target = joinPath(dir, relative);
			if (!target.startsWith(`${dir}/`)) continue;
			this.fs.mkdirSync(dirnamePath(target), { recursive: true });
			this.fs.writeFileSync(target, bytes);
		}
	}
}

/** The bin entries of the packages installed under `root/node_modules`, by command name. */
export function binsUnder(fs: TabFs, root: string): Map<string, string> {
	const bins = new Map<string, string>();
	const modules = joinPath(root, "node_modules");
	if (!fs.existsSync(modules)) return bins;
	const packageDirs = (fs.readdirSync(modules) as string[]).flatMap((name) =>
		name.startsWith("@")
			? (fs.readdirSync(joinPath(modules, name)) as string[]).map((inner) =>
					joinPath(modules, name, inner),
				)
			: name.startsWith(".")
				? []
				: [joinPath(modules, name)],
	);
	for (const dir of packageDirs) {
		const file = joinPath(dir, "package.json");
		if (!fs.existsSync(file)) continue;
		const manifest = JSON.parse(fs.readFileSync(file, "utf8") as string) as Manifest;
		const bin = manifest.bin;
		if (typeof bin === "string")
			bins.set(manifest.name.split("/").pop() ?? manifest.name, joinPath(dir, bin));
		else if (bin)
			for (const [name, target] of Object.entries(bin)) bins.set(name, joinPath(dir, target));
	}
	return bins;
}
