import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentRegistryEntry,
	DetectedAgent,
	InstalledAgent,
	Project,
} from "@thinkrail/contracts";
import { BUNDLED_AGENT_ID } from "../agent";
import { stopAllWatches } from "../watch";
import { setAgentCatalogPublisher } from "./agentCatalog";
import { handleRequest } from "./handlers";

const CTX = { clientKey: "test-client" };

let dataDir: string;
let changed: number;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const savedPath = process.env.PATH;
const realFetch = globalThis.fetch;

let served: AgentRegistryEntry[] = [];

function catalogIds(): string[] {
	const path = join(dataDir, "agents", "agents.json");
	if (!existsSync(path)) return [];
	const doc = JSON.parse(readFileSync(path, "utf8")) as { agents: { id: string }[] };
	return doc.agents.map((agent) => agent.id);
}

function registryDocument(): unknown {
	return {
		version: "1.0.0",
		agents: served.map((entry) => ({
			id: entry.id,
			name: entry.name,
			version: entry.version,
			distribution:
				entry.distribution?.kind === "binary"
					? {
							binary: {
								[`${process.platform === "win32" ? "windows" : process.platform}-${
									process.arch === "arm64" ? "aarch64" : "x86_64"
								}`]: {
									archive: entry.distribution.archive,
									cmd: entry.distribution.command,
									args: entry.distribution.args,
								},
							},
						}
					: {},
		})),
	};
}

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function seedProject(): void {
	const repo = join(dataDir, "repo");
	mkdirSync(repo, { recursive: true });
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "t@thinkrail.test");
	git(repo, "config", "user.name", "test");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-agent-catalog-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	changed = 0;
	served = [];
	setAgentCatalogPublisher(() => {
		changed += 1;
	});
	globalThis.fetch = Object.assign(
		async (): Promise<Response> => Response.json(registryDocument()),
		{
			preconnect: realFetch.preconnect,
		},
	);
});

afterEach(() => {
	stopAllWatches();
	setAgentCatalogPublisher(null);
	globalThis.fetch = realFetch;
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
	if (savedPath === undefined) delete process.env.PATH;
	else process.env.PATH = savedPath;
});

test("agent.add records an external agent, answers its catalog row, and invalidates clients", async () => {
	const added = (await handleRequest(
		"agent.add",
		{ id: "junie", name: "Junie", command: "/opt/homebrew/bin/junie", args: ["--acp=true"] },
		CTX,
	)) as InstalledAgent;

	expect(added).toMatchObject({
		id: "junie",
		name: "Junie",
		origin: "external",
		command: "/opt/homebrew/bin/junie",
		args: ["--acp=true"],
	});
	expect(catalogIds()).toEqual(["junie"]);
	expect(changed).toBe(1);

	const listed = (await handleRequest("agent.list", {}, CTX)) as InstalledAgent[];
	expect(listed.map((agent) => agent.id)).toEqual([BUNDLED_AGENT_ID, "junie"]);
});

test("agent.add falls back to the id when the form left the name blank", async () => {
	const added = (await handleRequest(
		"agent.add",
		{ id: "junie", name: "  ", command: "junie", args: [] },
		CTX,
	)) as InstalledAgent;

	expect(added.name).toBe("junie");
});

test("agent.add refuses the bundled agent's id, an id already registered, and an empty command", async () => {
	await expect(
		handleRequest("agent.add", { id: BUNDLED_AGENT_ID, name: "Mine", command: "x", args: [] }, CTX),
	).rejects.toThrow(`"${BUNDLED_AGENT_ID}" is the bundled agent's id — pick another.`);

	await expect(
		handleRequest("agent.add", { id: "junie", name: "Junie", command: "  ", args: [] }, CTX),
	).rejects.toThrow(`"junie" needs a command to launch.`);

	await handleRequest("agent.add", { id: "junie", name: "Junie", command: "junie", args: [] }, CTX);
	changed = 0;

	await expect(
		handleRequest(
			"agent.add",
			{ id: "junie", name: "Junie again", command: "other", args: [] },
			CTX,
		),
	).rejects.toThrow(`An agent named "junie" is already registered — remove it first.`);

	expect(catalogIds()).toEqual(["junie"]);
	expect(changed).toBe(0);
});

test("agent.remove forgets a registered agent and invalidates clients", async () => {
	await handleRequest("agent.add", { id: "junie", name: "Junie", command: "junie", args: [] }, CTX);
	changed = 0;

	expect(await handleRequest("agent.remove", { id: "junie" }, CTX)).toEqual({ ok: true });
	expect(catalogIds()).toEqual([]);
	expect(changed).toBe(1);
});

test("agent.remove refuses the bundled agent and names an unknown id", async () => {
	await expect(handleRequest("agent.remove", { id: BUNDLED_AGENT_ID }, CTX)).rejects.toThrow(
		`"${BUNDLED_AGENT_ID}" is the bundled agent and cannot be removed.`,
	);
	await expect(handleRequest("agent.remove", { id: "ghost" }, CTX)).rejects.toThrow(
		`No agent named "ghost" is registered.`,
	);
	expect(changed).toBe(0);
});

test("removing an agent leaves a project still pointed at it, so the dangling id fails at the point of use", async () => {
	seedProject();
	await handleRequest("agent.add", { id: "junie", name: "Junie", command: "junie", args: [] }, CTX);
	await handleRequest("agent.select", { projectId: "p1", agentId: "junie" }, CTX);

	await handleRequest("agent.remove", { id: "junie" }, CTX);

	const projects = (await handleRequest("project.list", {}, CTX)) as Project[];
	expect(projects.find((project) => project.id === "p1")?.agentId).toBe("junie");
	const listed = (await handleRequest("agent.list", {}, CTX)) as InstalledAgent[];
	expect(listed.map((agent) => agent.id)).toEqual([BUNDLED_AGENT_ID]);
});

test("agent.detect offers a shortlisted agent found here, and never one already registered", async () => {
	const bin = join(dataDir, "bin");
	mkdirSync(bin, { recursive: true });
	const junie = join(bin, "junie");
	writeFileSync(junie, "#!/bin/sh\n");
	chmodSync(junie, 0o755);
	process.env.PATH = bin;
	served = [
		{
			id: "junie",
			name: "Junie",
			version: "2913.6",
			installed: false,
			distribution: {
				kind: "binary",
				archive: "https://example.test/junie.zip",
				command: "./Applications/junie.app/Contents/MacOS/junie",
				args: ["--acp=true"],
			},
		},
	];
	await handleRequest("agent.registry", { refresh: true }, CTX);

	const offered = (await handleRequest("agent.detect", {}, CTX)) as DetectedAgent[];
	expect(offered).toEqual([
		{
			id: "junie",
			name: "Junie",
			command: junie,
			args: ["--acp=true"],
			source: "path",
			detail: junie,
		},
	]);

	await handleRequest("agent.add", { id: "junie", name: "Junie", command: junie, args: [] }, CTX);
	expect(await handleRequest("agent.detect", {}, CTX)).toEqual([]);
});
