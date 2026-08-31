import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installAgent, listRegistry } from "./agentInstall";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const realFetch = globalThis.fetch;

interface Served {
	document: unknown;
	failures: number;
	calls: number;
}

const served: Served = { document: {}, failures: 0, calls: 0 };

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-agent-install-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	served.document = { version: "1.0.0", agents: [] };
	served.failures = 0;
	served.calls = 0;
	const stub: typeof fetch = Object.assign(
		async (): Promise<Response> => {
			served.calls += 1;
			if (served.failures > 0) {
				served.failures -= 1;
				return new Response("nope", { status: 503 });
			}
			return Response.json(served.document);
		},
		{ preconnect: realFetch.preconnect },
	);
	globalThis.fetch = stub;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function npxAgent(id: string, pkg: string): Record<string, unknown> {
	return {
		id,
		name: id,
		version: "1.2.3",
		distribution: { npx: { package: pkg } },
	};
}

test("a failed registry fetch answers stale with whatever was last known, never an empty list", async () => {
	served.document = { version: "1.0.0", agents: [npxAgent("junie", "@jetbrains/junie")] };
	const first = await listRegistry(true);
	expect(first.stale).toBe(false);
	expect(first.entries.map((e) => e.id)).toEqual(["junie"]);

	served.failures = 1;
	const second = await listRegistry(true);
	expect(second.stale).toBe(true);
	expect(second.entries.map((e) => e.id)).toEqual(["junie"]);
});

test("a cached list inside the TTL is answered without a fetch and is NOT stale", async () => {
	served.document = { version: "1.0.0", agents: [npxAgent("junie", "@jetbrains/junie")] };
	await listRegistry(true);
	const callsAfterFirst = served.calls;

	const cachedRead = await listRegistry(false);

	expect(served.calls).toBe(callsAfterFirst);
	expect(cachedRead.stale).toBe(false);
	expect(cachedRead.entries.map((e) => e.id)).toEqual(["junie"]);
});

test("installing a runner-distributed agent records it in the catalog and lists it as installed", async () => {
	served.document = { version: "1.0.0", agents: [npxAgent("junie", "@jetbrains/junie")] };
	await listRegistry(true);

	const installed = await installAgent("junie");

	expect(installed.id).toBe("junie");
	expect(installed.origin).toBe("installed");
	expect(installed.command).toBe("npx");
	expect(installed.args).toEqual(["-y", "@jetbrains/junie"]);

	const catalog = JSON.parse(readFileSync(join(dataDir, "agents", "agents.json"), "utf8"));
	expect(catalog.agents.map((a: { id: string }) => a.id)).toEqual(["junie"]);

	const listed = await listRegistry(false);
	expect(listed.entries.find((e) => e.id === "junie")?.installed).toBe(true);
});

test("an agent the registry does not carry is refused by name", async () => {
	served.document = { version: "1.0.0", agents: [] };
	await listRegistry(true);

	expect(installAgent("nope")).rejects.toThrow(/No agent named "nope"/);
});

test("an agent with no distribution for this platform is refused, not half-recorded", async () => {
	served.document = {
		version: "1.0.0",
		agents: [
			{
				id: "opaque",
				name: "opaque",
				version: "1",
				distribution: { binary: { "plan9-vax": { archive: "x", cmd: "y" } } },
			},
		],
	};
	await listRegistry(true);

	expect(installAgent("opaque")).rejects.toThrow(/no distribution/);
	expect(existsSync(join(dataDir, "agents", "agents.json"))).toBe(false);
});
