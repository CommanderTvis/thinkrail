import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRegistryEntry } from "@thinkrail/contracts";
import { forgetAgent, readAgentCatalog, recordAgent } from "./catalog";
import type { DetectionProbe } from "./detect";
import { DETECTION_SHORTLIST, detectAgents } from "./detect";
import { fetchRegistry, parseRegistryDocument, platformCandidates } from "./fetch";
import fixture from "./registry.fixture.json" with { type: "json" };
import { markInstalled, planInstall } from "./resolve";
import type { AgentCatalogEntry } from "./types";

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "thinkrail-registry-"));
	try {
		return await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("platformCandidates", () => {
	test("puts the registry's real spelling first", () => {
		expect(platformCandidates("darwin", "arm64")[0]).toBe("darwin-aarch64");
		expect(platformCandidates("linux", "x64")[0]).toBe("linux-x86_64");
		expect(platformCandidates("win32", "x64")[0]).toBe("windows-x86_64");
	});

	test("keeps aliases as fallbacks so a future spelling still resolves", () => {
		expect(platformCandidates("darwin", "arm64")).toContain("macos-arm64");
	});
});

describe("parseRegistryDocument", () => {
	test("reads the captured live document", () => {
		const entries = parseRegistryDocument(fixture, "darwin", "arm64");
		expect(entries.length).toBe(fixture.agents.length);
		expect(entries.every((e) => e.installed === false)).toBe(true);
	});

	test("resolves a native build for the running platform", () => {
		const [entry] = parseRegistryDocument(
			{
				agents: [
					{
						id: "junie",
						name: "Junie",
						version: "1",
						distribution: {
							binary: {
								"darwin-aarch64": {
									archive: "https://example.test/j.zip",
									cmd: "./junie",
									args: ["--acp=true"],
									sha256: "abc",
								},
							},
						},
					},
				],
			},
			"darwin",
			"arm64",
		);
		expect(entry?.distribution).toEqual({
			kind: "binary",
			archive: "https://example.test/j.zip",
			command: "./junie",
			args: ["--acp=true"],
			sha256: "abc",
		});
	});

	test("keeps an entry with no build for this platform, marked unavailable", () => {
		const [entry] = parseRegistryDocument(
			{
				agents: [
					{
						id: "j",
						name: "J",
						version: "1",
						distribution: { binary: { "linux-x86_64": { archive: "u", cmd: "c" } } },
					},
				],
			},
			"darwin",
			"arm64",
		);
		expect(entry?.id).toBe("j");
		expect(entry?.distribution).toBeNull();
	});

	test("skips malformed records without emptying the list", () => {
		const entries = parseRegistryDocument(
			{
				agents: [
					null,
					"nonsense",
					{ name: "no id", version: "1", distribution: { npx: { package: "p" } } },
					{ id: "dup", name: "A", version: "1", distribution: { npx: { package: "a@1" } } },
					{ id: "dup", name: "B", version: "2", distribution: { npx: { package: "b@2" } } },
					{ id: "ok", name: "Ok", version: "1", distribution: { uvx: { package: "o==1" } } },
				],
			},
			"linux",
			"x64",
		);
		expect(entries.map((e) => e.id)).toEqual(["dup", "ok"]);
		expect(entries[0]?.name).toBe("A");
		expect(entries[1]?.distribution).toEqual({ kind: "uvx", package: "o==1" });
	});

	test("a non-document yields an empty list rather than throwing", () => {
		expect(parseRegistryDocument(null, "linux", "x64")).toEqual([]);
		expect(parseRegistryDocument({ agents: "no" }, "linux", "x64")).toEqual([]);
	});
});

describe("fetchRegistry", () => {
	const ok = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body });

	test("serves the cache with stale:true when the network fails", async () => {
		const cached = parseRegistryDocument(fixture, "darwin", "arm64");
		const result = await fetchRegistry({
			fetchImpl: async () => {
				throw new Error("offline");
			},
			platform: "darwin",
			arch: "arm64",
			cached,
		});
		expect(result.stale).toBe(true);
		expect(result.entries).toBe(cached);
	});

	test("serves the cache with stale:true on a non-ok response", async () => {
		const result = await fetchRegistry({
			fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
			platform: "darwin",
			arch: "arm64",
			cached: [],
		});
		expect(result).toEqual({ entries: [], stale: true });
	});

	test("a fresh document is not stale", async () => {
		const result = await fetchRegistry({
			fetchImpl: ok(fixture),
			platform: "darwin",
			arch: "arm64",
		});
		expect(result.stale).toBe(false);
		expect(result.entries.length).toBe(fixture.agents.length);
	});
});

describe("planInstall", () => {
	test("a binary build downloads into a versioned dir and launches from it", () => {
		const plan = planInstall(
			{
				id: "junie",
				name: "Junie",
				version: "2913.6.0",
				installed: false,
				distribution: {
					kind: "binary",
					archive: "https://example.test/j.zip",
					command: "./junie/junie",
					args: ["--acp=true"],
					sha256: "deadbeef",
				},
			},
			"/data/agents",
		);
		expect(plan?.download).toEqual({
			url: "https://example.test/j.zip",
			dir: "/data/agents/junie/2913.6.0",
			sha256: "deadbeef",
		});
		expect(plan?.entry.launch.command).toBe("/data/agents/junie/2913.6.0/junie/junie");
		expect(plan?.entry.dir).toBe("/data/agents/junie/2913.6.0");
	});

	test("npx and uvx have nothing to download and keep the pinned package spec", () => {
		const npx = planInstall(
			{
				id: "codex",
				name: "Codex",
				version: "1",
				installed: false,
				distribution: { kind: "npx", package: "codex-acp@1.2.3", args: ["--acp"] },
			},
			"/data/agents",
		);
		expect(npx?.download).toBeNull();
		expect(npx?.entry.launch).toEqual({ command: "npx", args: ["-y", "codex-acp@1.2.3", "--acp"] });
		expect(npx?.entry.dir).toBeUndefined();

		const uvx = planInstall(
			{
				id: "fast-agent",
				name: "fast-agent",
				version: "1",
				installed: false,
				distribution: { kind: "uvx", package: "fast-agent-acp==0.10.1", args: ["-x"] },
			},
			"/data/agents",
		);
		expect(uvx?.entry.launch).toEqual({ command: "uvx", args: ["fast-agent-acp==0.10.1", "-x"] });
	});

	test("an entry unavailable on this platform has no plan", () => {
		expect(
			planInstall({ id: "x", name: "X", version: "1", installed: false, distribution: null }, "/d"),
		).toBeNull();
	});
});

describe("markInstalled", () => {
	test("flags installed agents and reports an older local version", () => {
		const entries = parseRegistryDocument(fixture, "darwin", "arm64");
		const first = entries[0];
		if (first === undefined) throw new Error("fixture has no agents");
		const marked = markInstalled(entries, [
			{
				id: first.id,
				name: first.name,
				version: "0.0.1",
				origin: "installed",
				launch: { command: "x", args: [] },
			},
		]);
		expect(marked[0]?.installed).toBe(true);
		expect(marked[0]?.installedVersion).toBe("0.0.1");
		expect(marked[1]?.installed).toBe(false);
	});

	test("a matching version reports no update", () => {
		const entries = parseRegistryDocument(fixture, "darwin", "arm64");
		const first = entries[0];
		if (first === undefined) throw new Error("fixture has no agents");
		const marked = markInstalled(entries, [
			{
				id: first.id,
				name: first.name,
				version: first.version,
				origin: "installed",
				launch: { command: "x", args: [] },
			},
		]);
		expect(marked[0]?.installedVersion).toBeUndefined();
	});
});

describe("catalog", () => {
	const entry: AgentCatalogEntry = {
		id: "junie",
		name: "Junie",
		version: "1",
		origin: "installed",
		launch: { command: "/agents/junie/junie", args: ["--acp=true"] },
	};

	test("a missing catalog reads as empty", async () => {
		await withTempDir(async (dir) => {
			expect(await readAgentCatalog(dir)).toEqual([]);
		});
	});

	test("record then read round-trips, and re-recording replaces by id", async () => {
		await withTempDir(async (dir) => {
			await recordAgent(dir, entry);
			await recordAgent(dir, { ...entry, version: "2" });
			const agents = await readAgentCatalog(dir);
			expect(agents).toEqual([{ ...entry, version: "2" }]);
		});
	});

	test("external and installed agents share one list", async () => {
		await withTempDir(async (dir) => {
			await recordAgent(dir, entry);
			await recordAgent(dir, {
				id: "system-pi",
				name: "pi (system)",
				origin: "external",
				launch: { command: "/usr/local/bin/pi-acp", args: [] },
			});
			const agents = await readAgentCatalog(dir);
			expect(agents.map((a) => a.origin).sort()).toEqual(["external", "installed"]);
		});
	});

	test("a damaged catalog yields the entries that still parse", async () => {
		await withTempDir(async (dir) => {
			await recordAgent(dir, entry);
			const path = join(dir, "agents.json");
			const doc = JSON.parse(await readFile(path, "utf8")) as { agents: unknown[] };
			doc.agents.push({ id: "broken" }, null);
			await Bun.write(path, JSON.stringify(doc));
			expect((await readAgentCatalog(dir)).map((a) => a.id)).toEqual(["junie"]);
		});
	});

	test("unparseable JSON yields empty rather than throwing", async () => {
		await withTempDir(async (dir) => {
			await Bun.write(join(dir, "agents.json"), "{ not json");
			expect(await readAgentCatalog(dir)).toEqual([]);
		});
	});

	test("forgetting an archive install removes the directory it owns", async () => {
		await withTempDir(async (dir) => {
			const owned = join(dir, "junie", "1");
			await Bun.write(join(owned, "junie"), "#!/bin/sh\n");
			await recordAgent(dir, { ...entry, dir: owned });
			const left = await forgetAgent(dir, "junie");
			expect(left).toEqual([]);
			expect(await Bun.file(join(owned, "junie")).exists()).toBe(false);
		});
	});

	test("forgetting an npx entry removes only the row", async () => {
		await withTempDir(async (dir) => {
			await recordAgent(dir, entry);
			expect(await forgetAgent(dir, "junie")).toEqual([]);
			expect(await forgetAgent(dir, "absent")).toEqual([]);
		});
	});
});

describe("detectAgents", () => {
	function probeFor(found: Record<string, string>): DetectionProbe {
		const asked: string[] = [];
		const probe: DetectionProbe = async (query) => {
			const key =
				query.kind === "command" ? `command:${query.name}` : `${query.runner}:${query.package}`;
			asked.push(key);
			return found[key] ?? null;
		};
		return Object.assign(probe, { asked });
	}

	function binaryEntry(id: string, command: string, args: string[]): AgentRegistryEntry {
		return {
			id,
			name: id,
			version: "1",
			installed: false,
			distribution: { kind: "binary", archive: "https://example.test/a.zip", command, args },
		};
	}

	function npxEntry(id: string, pkg: string, args?: string[]): AgentRegistryEntry {
		return {
			id,
			name: id,
			version: "1",
			installed: false,
			distribution: { kind: "npx", package: pkg, ...(args === undefined ? {} : { args }) },
		};
	}

	test("the shortlist is what ships, and junie leads it", () => {
		expect(DETECTION_SHORTLIST[0]).toBe("junie");
		expect([...DETECTION_SHORTLIST]).toEqual([
			"junie",
			"claude-acp",
			"codex-acp",
			"gemini",
			"github-copilot-cli",
			"cursor",
			"opencode",
			"goose",
		]);
	});

	test("every shortlisted id is published by the captured live registry", () => {
		const published = new Set(parseRegistryDocument(fixture, "darwin", "arm64").map((e) => e.id));
		expect(DETECTION_SHORTLIST.filter((id) => !published.has(id))).toEqual([]);
	});

	test("a binary agent already on PATH resolves to that path and the entry's own args", async () => {
		const detected = await detectAgents({
			entries: [
				binaryEntry("junie", "./Applications/junie.app/Contents/MacOS/junie", ["--acp=true"]),
			],
			catalog: [],
			probe: probeFor({ "command:junie": "/opt/homebrew/bin/junie" }),
			shortlist: ["junie"],
		});

		expect(detected).toEqual([
			{
				id: "junie",
				name: "junie",
				command: "/opt/homebrew/bin/junie",
				args: ["--acp=true"],
				source: "path",
				detail: "/opt/homebrew/bin/junie",
			},
		]);
	});

	test("a Windows launcher name loses its extension before the lookup", async () => {
		const probe = probeFor({ "command:cursor-agent": "C:\\bin\\cursor-agent.cmd" });
		const detected = await detectAgents({
			entries: [binaryEntry("cursor", "./dist-package\\cursor-agent.cmd", ["acp"])],
			catalog: [],
			probe,
			shortlist: ["cursor"],
		});

		expect(detected.map((row) => row.command)).toEqual(["C:\\bin\\cursor-agent.cmd"]);
	});

	test("an agent whose command does not resolve here is absent, not a disabled row", async () => {
		const detected = await detectAgents({
			entries: [binaryEntry("junie", "./junie", ["--acp=true"])],
			catalog: [],
			probe: probeFor({}),
			shortlist: ["junie"],
		});

		expect(detected).toEqual([]);
	});

	test("an agent already in the catalog is installed, never re-offered — and is not probed", async () => {
		const probe = probeFor({ "command:junie": "/opt/homebrew/bin/junie" }) as DetectionProbe & {
			asked: string[];
		};
		const catalog: AgentCatalogEntry[] = [
			{
				id: "junie",
				name: "Junie",
				origin: "external",
				launch: { command: "/opt/homebrew/bin/junie", args: ["--acp=true"] },
			},
		];

		const detected = await detectAgents({
			entries: [binaryEntry("junie", "./junie", ["--acp=true"])],
			catalog,
			probe,
			shortlist: ["junie"],
		});

		expect(detected).toEqual([]);
		expect(probe.asked).toEqual([]);
	});

	test("a shortlist entry the registry no longer publishes is skipped, and the rest still resolve", async () => {
		const detected = await detectAgents({
			entries: [binaryEntry("goose", "./goose", ["acp"])],
			catalog: [],
			probe: probeFor({ "command:goose": "/usr/local/bin/goose" }),
			shortlist: ["junie", "goose"],
		});

		expect(detected.map((row) => row.id)).toEqual(["goose"]);
	});

	test("a runner agent needs the runner AND the package already present globally", async () => {
		const entries = [npxEntry("gemini", "@google/gemini-cli@0.56.0", ["--acp"])];

		expect(
			await detectAgents({ entries, catalog: [], probe: probeFor({}), shortlist: ["gemini"] }),
		).toEqual([]);

		expect(
			await detectAgents({
				entries,
				catalog: [],
				probe: probeFor({ "npx:@google/gemini-cli": "/usr/local/bin/npx" }),
				shortlist: ["gemini"],
			}),
		).toEqual([
			{
				id: "gemini",
				name: "gemini",
				command: "/usr/local/bin/npx",
				args: ["-y", "@google/gemini-cli@0.56.0", "--acp"],
				source: "npx",
				detail: "@google/gemini-cli@0.56.0",
			},
		]);
	});

	test("an entry with no distribution for this platform, or one needing env, is not one-click", async () => {
		const noDistribution: AgentRegistryEntry = {
			id: "junie",
			name: "junie",
			version: "1",
			installed: false,
			distribution: null,
		};
		const needsEnv: AgentRegistryEntry = {
			id: "goose",
			name: "goose",
			version: "1",
			installed: false,
			distribution: {
				kind: "binary",
				archive: "https://example.test/a.zip",
				command: "./goose",
				args: ["acp"],
				env: { GOOSE_MODE: "acp" },
			},
		};

		expect(
			await detectAgents({
				entries: [noDistribution, needsEnv],
				catalog: [],
				probe: probeFor({ "command:junie": "/x/junie", "command:goose": "/x/goose" }),
				shortlist: ["junie", "goose"],
			}),
		).toEqual([]);
	});
});
