import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type {
	AppConfig,
	PluginRosterEntry,
	Project,
	ResourceMeta,
	Template,
	TemplateInfo,
	WireModel,
	Workspace,
	WorkspaceWatchReadyResult,
} from "@thinkrail/contracts";
import {
	BRANCH_STATUS_PROTOCOL_VERSION,
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
	WS_METHODS,
} from "@thinkrail/contracts";
import { TodoStore } from "pi-todos/core";
import {
	type CreateSessionResult,
	configurePiRuntime,
	disposeAllSessions,
	setSessionManagerFactory,
} from "../agent";
import { recordAcceptedMessage, resetFeedbackForTests, setFeedbackPublisher } from "../feedback";
import { defaultSessionDirFor, writeFixtureSession } from "../history/testFixtures";
import type { PluginRuntime } from "../plugins";
import { addComment, getReviewSnapshot } from "../reviews";
import { resetConfigCache } from "../settings";
import { todoReviewRecord } from "../todos";
import { stopAllWatches } from "../watch";
import {
	handleRequest,
	openReviewForClient,
	requestMethodDiagnostic,
	setPluginRuntime,
	shouldRefreshOpenReview,
} from "./handlers";

const CTX = { clientKey: "test-client" };

function stubPluginRuntime(overrides: Partial<PluginRuntime> = {}): PluginRuntime {
	return {
		roster: () => [],
		allowsExternalFile: () => false,
		handleRequest: async () => {
			throw new Error("Unknown method");
		},
		serveRoute: async () => new Response("not found", { status: 404 }),
		channelNames: () => [],
		mcpTools: () => [],
		terminalEnv: () => ({}),
		onTerminalEvent: () => {},
		revivePrefill: () => null,
		workspaceEvent: () => {},
		fsChanged: () => {},
		settingsChanged: () => {},
		validateSettings: (_update, current) => current,
		reconcile: async () => {},
		rescan: async () => [],
		retry: async () => [],
		piResources: () => ({
			factories: [],
			extensionPaths: [],
			skillPaths: [],
			childFactories: [],
			toolsExtension: (() => {}) as ExtensionFactory,
		}),
		toolsExtension: (() => {}) as ExtensionFactory,
		dispose: () => {},
		...overrides,
	};
}

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

async function setupDefaultModelRuntime(): Promise<() => void> {
	const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = join(dataDir, "agent");
	mkdirSync(agentDir);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	const model = {
		id: "handler-model",
		name: "Handler model",
		api: "faux",
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4_096,
	};
	const faux = createFauxCore({ provider: "handler", api: "faux", models: [model] });
	runtime.registerProvider("handler", {
		api: "faux",
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [model],
	});
	configurePiRuntime(runtime);
	return () => {
		configurePiRuntime(null);
		if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
	};
}

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function gitText(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
	return new TextDecoder().decode(result.stdout).trim();
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-handlers-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetConfigCache();
	resetFeedbackForTests();
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "t@thinkrail.test");
	git(repo, "config", "user.name", "test");
	git(repo, "config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
});

afterEach(() => {
	stopAllWatches();
	resetConfigCache();
	resetFeedbackForTests();
	setPluginRuntime(null);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("every contract method has a registered handler", () => {
	const unregistered = Object.values(WS_METHODS).filter((m) => requestMethodDiagnostic(m) !== m);
	expect(unregistered).toEqual([]);
});

test("clone handlers resolve the destination and return an opened local project", async () => {
	const input = {
		operationId: "clone-handler",
		url: pathToFileURL(repo).href,
		parentPath: dataDir,
		name: "cloned",
	};
	const destination = (await handleRequest("project.cloneDestination", input, CTX)) as {
		path: string;
	};
	const project = (await handleRequest("project.clone", input, CTX)) as Project;
	expect(project.path).toBe(destination.path);
	expect(gitText(project.path, "rev-parse", "HEAD")).toBe(gitText(repo, "rev-parse", "HEAD"));
	expect(
		await handleRequest("project.cancelClone", { operationId: input.operationId }, CTX),
	).toEqual({ ok: true });
});

test("open-review cache reuse is opt-in so older clients remain fresh", () => {
	expect(shouldRefreshOpenReview(undefined)).toBe(true);
	expect(shouldRefreshOpenReview(false)).toBe(true);
	expect(shouldRefreshOpenReview(true)).toBe(false);
});

test("a client older than the settled protocol never hears about a merged or closed review", () => {
	const merged = { kind: "pull-request", number: 9, state: "merged" } as const;
	const open = { kind: "pull-request", number: 10, state: "open" } as const;
	const stateless = { kind: "pull-request", number: 11 } as const;
	expect(openReviewForClient(merged, WORKSPACE_SETTLE_PROTOCOL_VERSION - 1)).toBeNull();
	expect(openReviewForClient(open, WORKSPACE_SETTLE_PROTOCOL_VERSION - 1)).toBe(open);
	expect(openReviewForClient(stateless, WORKSPACE_SETTLE_PROTOCOL_VERSION - 1)).toBe(stateless);
	expect(openReviewForClient(merged, WORKSPACE_SETTLE_PROTOCOL_VERSION)).toBe(merged);
	expect(openReviewForClient(merged, undefined)).toBe(merged);
	expect(openReviewForClient(null, WORKSPACE_SETTLE_PROTOCOL_VERSION - 1)).toBeNull();
});

test("starting a PR mutation reactivates a parked workspace before any network await", async () => {
	const workspace = (await handleRequest(
		"workspace.create",
		{ projectId: "p1", name: "PR work" },
		CTX,
	)) as Workspace;
	await handleRequest("workspace.settle", { id: workspace.id }, CTX);

	await expect(
		handleRequest("pr.open", { workspaceId: workspace.id, sessionId: "missing" }, CTX),
	).rejects.toThrow("no 'origin' remote");
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const after = rows.find((row) => row.id === workspace.id);
	expect(after?.settledOverride).toBeUndefined();
	expect(after?.lastActiveAt ?? 0).toBeGreaterThanOrEqual(workspace.lastActiveAt ?? 0);
});

test("branch status reports a review-free branch, and workspace.push publishes it", async () => {
	const workspace = (await handleRequest(
		"workspace.create",
		{ projectId: "p1", name: "Ship segment" },
		CTX,
	)) as Workspace;
	writeFileSync(join(workspace.worktreePath, "ship.txt"), "ship\n");
	git(workspace.worktreePath, "add", "-A");
	git(workspace.worktreePath, "commit", "-m", "ship");
	writeFileSync(join(workspace.worktreePath, "dirty.txt"), "dirty\n");

	const local = await handleRequest("workspace.branchStatus", { workspaceId: workspace.id }, CTX);
	expect(local).toEqual({
		hasOrigin: false,
		provider: null,
		published: false,
		pushesElsewhere: false,
		aheadOfBase: 1,
		onBase: false,
		review: null,
	});

	const remote = join(dataDir, "origin.git");
	mkdirSync(remote);
	git(remote, "init", "--bare");
	git(repo, "remote", "add", "origin", remote);
	expect(
		await handleRequest(
			"workspace.push",
			{ workspaceId: workspace.id, branch: workspace.branch },
			CTX,
		),
	).toEqual({
		dirtyFiles: 1,
	});
	const published = await handleRequest(
		"workspace.branchStatus",
		{ workspaceId: workspace.id },
		CTX,
	);
	expect(published).toMatchObject({
		hasOrigin: true,
		provider: null,
		published: true,
		ahead: 0,
		behind: 0,
		aheadOfBase: 1,
		review: null,
	});
});

test("a CI poll re-reads the review without fetching origin; a focus read still fetches", async () => {
	const workspace = (await handleRequest(
		"workspace.create",
		{ projectId: "p1", name: "Poll" },
		CTX,
	)) as Workspace;
	const remote = join(dataDir, "poll.git");
	mkdirSync(remote);
	git(remote, "init", "--bare");
	git(repo, "remote", "add", "origin", remote);
	await handleRequest(
		"workspace.push",
		{ workspaceId: workspace.id, branch: workspace.branch },
		CTX,
	);
	const other = join(dataDir, "poll-other");
	git(dataDir, "clone", "--branch", workspace.branch, remote, other);
	git(other, "config", "user.email", "t@thinkrail.test");
	git(other, "config", "user.name", "test");
	writeFileSync(join(other, "teammate.txt"), "teammate\n");
	git(other, "add", "-A");
	git(other, "commit", "-m", "teammate");
	git(other, "push", "origin", workspace.branch);

	expect(
		await handleRequest(
			"workspace.branchStatus",
			{ workspaceId: workspace.id, skipFetch: true },
			CTX,
		),
	).toMatchObject({ published: true, behind: 0 });
	expect(
		await handleRequest("workspace.branchStatus", { workspaceId: workspace.id }, CTX),
	).toMatchObject({ published: true, behind: 1 });
});

test("a split origin measures the branch against where it is pushed, not where it is fetched", async () => {
	const workspace = (await handleRequest(
		"workspace.create",
		{ projectId: "p1", name: "Split origin" },
		CTX,
	)) as Workspace;
	writeFileSync(join(workspace.worktreePath, "ship.txt"), "ship\n");
	git(workspace.worktreePath, "add", "-A");
	git(workspace.worktreePath, "commit", "-m", "ship");
	const fetchRepo = join(dataDir, "fetch.git");
	const pushRepo = join(dataDir, "push.git");
	for (const bare of [fetchRepo, pushRepo]) {
		mkdirSync(bare);
		git(bare, "init", "--bare");
	}
	git(repo, "remote", "add", "origin", fetchRepo);
	git(repo, "remote", "set-url", "--push", "origin", pushRepo);
	git(repo, "push", fetchRepo, "main");
	await handleRequest(
		"workspace.push",
		{ workspaceId: workspace.id, branch: workspace.branch },
		CTX,
	);

	const other = join(dataDir, "other");
	git(dataDir, "clone", fetchRepo, other);
	git(other, "config", "user.email", "t@thinkrail.test");
	git(other, "config", "user.name", "test");
	git(other, "switch", "-c", workspace.branch);
	writeFileSync(join(other, "unrelated.txt"), "unrelated\n");
	git(other, "add", "-A");
	git(other, "commit", "-m", "unrelated on the fetch side");
	git(other, "push", "origin", workspace.branch);
	git(workspace.worktreePath, "fetch", "origin");
	git(other, "push", "origin", "--delete", workspace.branch);

	expect(
		await handleRequest("workspace.branchStatus", { workspaceId: workspace.id }, CTX),
	).toMatchObject({ published: true, pushesElsewhere: true, ahead: 0, behind: 0 });

	const pushed = join(dataDir, "pushed");
	git(dataDir, "clone", "--branch", workspace.branch, pushRepo, pushed);
	git(pushed, "config", "user.email", "t@thinkrail.test");
	git(pushed, "config", "user.name", "test");
	writeFileSync(join(pushed, "later.txt"), "later\n");
	git(pushed, "add", "-A");
	git(pushed, "commit", "-m", "later on the push side");
	git(pushed, "push", "origin", workspace.branch);

	git(workspace.worktreePath, "fetch", "--prune", "origin");

	expect(
		await handleRequest(
			"workspace.branchStatus",
			{ workspaceId: workspace.id, allowCached: true },
			CTX,
		),
	).toMatchObject({ published: true, ahead: 0, behind: 1 });
});

test("a split origin whose push repository can't be read reports publication as unknown", async () => {
	const workspace = (await handleRequest(
		"workspace.create",
		{ projectId: "p1", name: "Unreachable push" },
		CTX,
	)) as Workspace;
	const fetchRepo = join(dataDir, "fetch-only.git");
	mkdirSync(fetchRepo);
	git(fetchRepo, "init", "--bare");
	git(repo, "remote", "add", "origin", fetchRepo);
	git(workspace.worktreePath, "push", fetchRepo, `HEAD:refs/heads/${workspace.branch}`);
	git(workspace.worktreePath, "fetch", "origin");
	git(repo, "remote", "set-url", "--push", "origin", join(dataDir, "missing.git"));

	const status = await handleRequest("workspace.branchStatus", { workspaceId: workspace.id }, CTX);
	expect(status).toMatchObject({ hasOrigin: true, pushesElsewhere: true, published: null });
	expect(status).not.toHaveProperty("ahead");
});

test("a pre-v87 client's source-less PR preview keeps the session's plan body", async () => {
	const workspace = (await handleRequest(
		"workspace.create",
		{ projectId: "p1", name: "Legacy preview" },
		CTX,
	)) as Workspace;
	writeFileSync(join(workspace.worktreePath, "ship.txt"), "ship\n");
	git(workspace.worktreePath, "add", "-A");
	git(workspace.worktreePath, "commit", "-m", "ship it");
	const params = { workspaceId: workspace.id, sessionId: "legacy-session" };

	const legacy = (await handleRequest("pr.preview", params, {
		...CTX,
		protocolVersion: BRANCH_STATUS_PROTOCOL_VERSION - 1,
	})) as { body: string };
	expect(legacy.body).toContain("## Committed outside the plan");
	const current = (await handleRequest("pr.preview", params, CTX)) as {
		body: string;
		source: string;
	};
	expect(current).toMatchObject({ source: "commits", body: "- ship it" });
});

test("request diagnostics expose only registered method names", async () => {
	expect(requestMethodDiagnostic("workspace.list")).toBe("workspace.list");
	expect(requestMethodDiagnostic("host.update")).toBe("host.update");
	expect(requestMethodDiagnostic("secret prompt value")).toBe("unknown method");
	expect(requestMethodDiagnostic("toString")).toBe("unknown method");
	await expect(handleRequest("toString", undefined, CTX)).rejects.toThrow("Unknown method");
});

test("host.update invokes only the context-injected parameterless operation", async () => {
	let runs = 0;
	expect(
		await handleRequest(
			"host.update",
			{ command: "private-command", version: "99.0.0" },
			{ clientKey: "test-client", runHostUpdate: () => runs++ },
		),
	).toEqual({ ok: true });
	expect(runs).toBe(1);
	await expect(handleRequest("host.update", {}, CTX)).rejects.toThrow(
		"Host update is unavailable.",
	);
});

test("retired session activity returns the empty compatibility snapshot", async () => {
	expect(await handleRequest("session.activityList", {}, CTX)).toEqual([]);
});

test("the retired ask answer method and respondToTool both refuse an unknown session the same way", async () => {
	await expect(
		handleRequest(
			"session.answerQuestion",
			{ sessionId: "nope", toolCallId: "tc", result: {} },
			CTX,
		),
	).rejects.toThrow("Unknown session: nope");
	await expect(
		handleRequest(
			"session.respondToTool",
			{ sessionId: "nope", toolCallId: "tc", response: {} },
			CTX,
		),
	).rejects.toThrow("Unknown session: nope");
});

test("a plugin method with no runtime installed answers Unknown method", async () => {
	expect(requestMethodDiagnostic("plugin.spec-dialect.specs")).toBe("plugin.spec-dialect.specs");
	await expect(handleRequest("plugin.spec-dialect.specs", undefined, CTX)).rejects.toThrow(
		"Unknown method",
	);
	expect(await handleRequest("plugins.list", undefined, CTX)).toEqual([]);
});

test("an unknown plugin method falls through to the installed runtime", async () => {
	setPluginRuntime(stubPluginRuntime());
	await expect(handleRequest("plugin.spec-dialect.specs", undefined, CTX)).rejects.toThrow(
		"Unknown method",
	);
});

test("plugins.list answers the installed runtime's roster", async () => {
	const roster: PluginRosterEntry[] = [
		{
			id: "spec-dialect",
			label: "Spec Dialect",
			icon: "book-open",
			version: "1.0.0",
			wireVersion: 1,
			origin: "builtin",
			status: "active",
			dependsOn: [],
			modifiesSystemPrompt: false,
			contributes: { sideTools: [], fileViewers: [] },
			channels: {},
		},
	];
	setPluginRuntime(stubPluginRuntime({ roster: () => roster }));
	expect(await handleRequest("plugins.list", undefined, CTX)).toEqual(roster);
});

test("plugins.rescan and plugins.retry reach the installed runtime", async () => {
	let rescanned = false;
	let retriedId: string | undefined;
	setPluginRuntime(
		stubPluginRuntime({
			rescan: async () => {
				rescanned = true;
				return [];
			},
			retry: async (id) => {
				retriedId = id;
				return [];
			},
		}),
	);
	await handleRequest("plugins.rescan", undefined, CTX);
	expect(rescanned).toBe(true);
	await handleRequest("plugins.retry", { id: "spec-dialect" }, CTX);
	expect(retriedId).toBe("spec-dialect");
});

test("plugins.rescan and plugins.retry reject before any runtime is installed", async () => {
	await expect(handleRequest("plugins.rescan", undefined, CTX)).rejects.toThrow(
		"Plugins are not initialized",
	);
	await expect(handleRequest("plugins.retry", { id: "spec-dialect" }, CTX)).rejects.toThrow(
		"Plugins are not initialized",
	);
});

test("settings.update cascades a plugin disable to its dependents and notifies the runtime", async () => {
	const roster: PluginRosterEntry[] = [
		{
			id: "base",
			label: "Base",
			icon: "puzzle",
			version: "1.0.0",
			wireVersion: 1,
			origin: "builtin",
			status: "active",
			dependsOn: [],
			modifiesSystemPrompt: false,
			contributes: { sideTools: [], fileViewers: [] },
			channels: {},
		},
		{
			id: "dependent",
			label: "Dependent",
			icon: "puzzle",
			version: "1.0.0",
			wireVersion: 1,
			origin: "builtin",
			status: "active",
			dependsOn: ["base"],
			modifiesSystemPrompt: false,
			contributes: { sideTools: [], fileViewers: [] },
			channels: {},
		},
	];
	let notified: AppConfig | undefined;
	setPluginRuntime(
		stubPluginRuntime({
			roster: () => roster,
			settingsChanged: (config) => {
				notified = config;
			},
		}),
	);

	const updated = (await handleRequest(
		"settings.update",
		{ config: { plugins: { base: { enabled: false } } } },
		CTX,
	)) as AppConfig;

	expect(updated.plugins.base?.enabled).toBe(false);
	expect(updated.plugins.dependent?.enabled).toBe(false);
	expect(notified).toBe(updated);
});

test("template reads resolve a project's current checkout and reject ambiguous locations", async () => {
	const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = join(dataDir, "agent");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const globalDir = join(agentDir, "prompts");
		const projectDir = join(repo, ".pi", "prompts");
		mkdirSync(globalDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(join(globalDir, "kickoff.md"), "global body");
		writeFileSync(join(projectDir, "kickoff.md"), "project body");

		const listed = (await handleRequest("template.list", { projectId: "p1" }, CTX)) as {
			templates: TemplateInfo[];
		};
		expect(listed.templates).toContainEqual(
			expect.objectContaining({ name: "kickoff", scope: "project" }),
		);

		const template = (await handleRequest(
			"template.get",
			{ projectId: "p1", name: "kickoff" },
			CTX,
		)) as Template;
		expect(template).toMatchObject({ scope: "project", content: "project body" });

		await expect(
			handleRequest("template.list", { workspaceId: "unused", projectId: "p1" }, CTX),
		).rejects.toThrow("either workspaceId or projectId");
	} finally {
		if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
	}
});

test("model.default and new session creation share the AppConfig default resolution", async () => {
	const cleanup = await setupDefaultModelRuntime();
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd, { id: "default-resolution" }));
	try {
		const models = (await handleRequest("model.list", {}, CTX)) as WireModel[];
		const selected = models.find((model) => model.provider === "handler");
		if (!selected) throw new Error("handler test model was not available");
		await handleRequest(
			"settings.update",
			{ config: { defaultModel: selected, defaultEffort: "high" } },
			CTX,
		);
		const resolved = (await handleRequest("model.default", {}, CTX)) as {
			model: WireModel | null;
			thinkingLevel: string;
		};
		expect(resolved).toEqual({ model: selected, thinkingLevel: "off" });

		const workspace = (await handleRequest(
			"workspace.create",
			{ projectId: "p1" },
			CTX,
		)) as Workspace;
		const created = (await handleRequest(
			"session.create",
			{ workspaceId: workspace.id },
			CTX,
		)) as CreateSessionResult;
		expect(created).toMatchObject({ model: selected, thinkingLevel: "off" });
	} finally {
		disposeAllSessions();
		configurePiRuntime(null);
		setSessionManagerFactory((cwd) => SessionManager.create(cwd));
		cleanup();
	}
});

test("extension.list reflects disabledExtensions written through settings.update", async () => {
	expect(await handleRequest("extension.list", {}, CTX)).toEqual([
		{
			name: "visualize",
			title: "Visualize",
			description: expect.any(String),
			enabled: true,
			tools: ["visualize"],
			hasChildExtensions: false,
		},
		{
			name: "ask-user-question",
			title: "Ask user question",
			description: expect.any(String),
			enabled: true,
			tools: ["ask_user_question"],
			hasChildExtensions: false,
		},
		{
			name: "web-access",
			title: "Web access",
			description: expect.any(String),
			enabled: true,
			tools: ["web_search", "fetch_content", "get_search_content"],
			hasChildExtensions: true,
		},
	]);
	await handleRequest(
		"settings.update",
		{ config: { disabledExtensions: ["visualize", "web-access", "retired"] } },
		CTX,
	);
	expect(await handleRequest("extension.list", {}, CTX)).toMatchObject([
		{ name: "visualize", enabled: false },
		{ name: "ask-user-question", enabled: true },
		{ name: "web-access", enabled: false },
	]);
	await handleRequest("settings.update", { config: { disabledExtensions: [] } }, CTX);
	expect(await handleRequest("extension.list", {}, CTX)).toMatchObject([
		{ name: "visualize", enabled: true },
		{ name: "ask-user-question", enabled: true },
		{ name: "web-access", enabled: true },
	]);
});

test("disabled JetBrains quota returns hidden through its handler", async () => {
	await handleRequest("settings.update", { config: { jbcentralQuotaEnabled: false } }, CTX);
	expect(await handleRequest("provider.jbcentralQuota", { force: true }, CTX)).toEqual({
		state: "hidden",
	});
});

test("feedback.respond persists a popup action through the handler", async () => {
	setFeedbackPublisher(() => true);
	for (let count = 0; count < 10; count += 1) recordAcceptedMessage(CTX.clientKey);

	expect(await handleRequest("feedback.respond", { action: "postpone" }, CTX)).toEqual({
		ok: true,
	});
	expect(JSON.parse(readFileSync(join(dataDir, "feedback.json"), "utf8"))).toEqual({
		acceptedMessages: 10,
		nextInvitationAt: 20,
		dismissed: false,
	});
});

test("feedback.respond rejects an action outside the wire union", async () => {
	await expect(handleRequest("feedback.respond", { action: "later" }, CTX)).rejects.toThrow(
		"Invalid interview response",
	);
});

test("workspace.rename locks the display name without changing Git or the worktree path", async () => {
	const created = (await handleRequest("workspace.create", { projectId: "p1" }, CTX)) as Workspace;

	const renamed = (await handleRequest(
		"workspace.rename",
		{ id: created.id, name: "Manual Workspace Name" },
		CTX,
	)) as Workspace;

	expect(renamed).toMatchObject({
		id: created.id,
		name: "Manual Workspace Name",
		branch: created.branch,
		renamed: true,
		worktreePath: created.worktreePath,
	});
	expect(gitText(created.worktreePath, "symbolic-ref", "--short", "HEAD")).toBe(created.branch);
	const listed = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	expect(listed.find((workspace) => workspace.id === created.id)).toMatchObject(renamed);
});

test("session.rename persists a bounded title into a closed Pi transcript", async () => {
	const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = join(dataDir, "rename-agent");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
		const workspace = rows[0];
		if (!workspace) throw new Error("expected a workspace");
		const fixture = writeFixtureSession(defaultSessionDirFor(agentDir, workspace.worktreePath), {
			cwd: workspace.worktreePath,
			name: "Before rename",
			messages: [{ role: "user", text: "hello", timestamp: Date.now() }],
		});

		expect(
			await handleRequest(
				"session.rename",
				{ workspaceId: workspace.id, sessionId: fixture.id, title: "  After\r\nrename  " },
				CTX,
			),
		).toEqual({ ok: true });
		expect(SessionManager.open(fixture.path).getSessionName()).toBe("After rename");
		await expect(
			handleRequest(
				"session.rename",
				{ workspaceId: workspace.id, sessionId: fixture.id, title: " \n " },
				CTX,
			),
		).rejects.toThrow("Invalid session title");
		await expect(
			handleRequest(
				"session.rename",
				{ workspaceId: workspace.id, sessionId: fixture.id, title: "x".repeat(81) },
				CTX,
			),
		).rejects.toThrow("Invalid session title");
	} finally {
		if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
	}
});

test("workspace.setSubagentsOverride persists on/off and null restores the global default", async () => {
	const created = (await handleRequest("workspace.create", { projectId: "p1" }, CTX)) as Workspace;

	const enabled = (await handleRequest(
		"workspace.setSubagentsOverride",
		{ id: created.id, override: "on" },
		CTX,
	)) as Workspace;
	expect(enabled.subagentsOverride).toBe("on");

	const disabled = (await handleRequest(
		"workspace.setSubagentsOverride",
		{ id: created.id, override: "off" },
		CTX,
	)) as Workspace;
	expect(disabled.subagentsOverride).toBe("off");

	const inherited = (await handleRequest(
		"workspace.setSubagentsOverride",
		{ id: created.id, override: null },
		CTX,
	)) as Workspace;
	expect(inherited.subagentsOverride).toBeUndefined();
});

test("workspace.watchReady waits for startup once, then reports an already-ready watcher", async () => {
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const workspace = rows[0];
	if (!workspace) throw new Error("expected a workspace");

	const first = (await handleRequest(
		"workspace.watchReady",
		{ workspaceId: workspace.id },
		CTX,
	)) as WorkspaceWatchReadyResult;
	expect(first).toEqual({ startupNudge: true });
	const second = (await handleRequest(
		"workspace.watchReady",
		{ workspaceId: workspace.id },
		CTX,
	)) as WorkspaceWatchReadyResult;
	expect(second).toEqual({ startupNudge: false });
});

test("todo.requestFix on a chat that isn't on disk rolls the record back and never marks findings sent", async () => {
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const workspace = rows[0];
	if (!workspace) throw new Error("expected a workspace");
	const sessionId = "sess-fix";
	const todo = new TodoStore(workspace.worktreePath, sessionId).add({
		title: "t",
		artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
	});
	const finding = await addComment({
		workspaceId: workspace.id,
		kind: "inline",
		author: "agent",
		anchor: {
			path: "README.md",
			side: "worktree",
			contentHash: "",
			selectors: [{ kind: "lineRange", startLine: 1, endLine: 1 }],
		},
		body: "finding",
		origin: { todoId: todo.id, sessionId, reviewedSha: "sha1" },
	});

	await expect(
		handleRequest(
			"todo.requestFix",
			{ workspaceId: workspace.id, sessionId, id: todo.id, feedback: "please fix" },
			CTX,
		),
	).rejects.toThrow("no longer on disk");

	expect(todoReviewRecord({ workspaceId: workspace.id, sessionId, id: todo.id })).toBeUndefined();
	const after = (await getReviewSnapshot(workspace.id)).comments.find((c) => c.id === finding.id);
	expect(after?.status).toBe("draft");
	expect(after?.sessionId).toBeUndefined();
});

test("a review send that names its chat lands every file's drafts there as one package", async () => {
	const cleanup = await setupDefaultModelRuntime();
	let sessions = 0;
	setSessionManagerFactory((cwd) => {
		sessions += 1;
		return SessionManager.inMemory(cwd, { id: `review-send-${sessions}` });
	});
	try {
		const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
		const workspace = rows[0];
		if (!workspace) throw new Error("expected a workspace");
		writeFileSync(join(repo, "NOTES.md"), "notes\n");
		const chat = (await handleRequest(
			"session.create",
			{ workspaceId: workspace.id },
			CTX,
		)) as CreateSessionResult;
		const draft = (path: string) =>
			addComment({
				workspaceId: workspace.id,
				kind: "inline",
				anchor: {
					path,
					side: "worktree",
					contentHash: "",
					selectors: [{ kind: "lineRange", startLine: 1, endLine: 1 }],
				},
				body: `about ${path}`,
			});
		const ids = [(await draft("README.md")).id, (await draft("NOTES.md")).id];

		const sent = (await handleRequest(
			"review.sendBatch",
			{ workspaceId: workspace.id, sessionId: chat.sessionId },
			CTX,
		)) as { sessions: { sessionId: string }[] };

		expect(sent.sessions.map((session) => session.sessionId)).toEqual([chat.sessionId]);
		const comments = (await getReviewSnapshot(workspace.id)).comments.filter((comment) =>
			ids.includes(comment.id),
		);
		expect(comments.map((comment) => [comment.status, comment.sessionId])).toEqual([
			["sent", chat.sessionId],
			["sent", chat.sessionId],
		]);
	} finally {
		disposeAllSessions();
		configurePiRuntime(null);
		setSessionManagerFactory((cwd) => SessionManager.create(cwd));
		cleanup();
	}
});

test("workspace mutation handlers reject the Default before any side effect", async () => {
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const def = rows[0];
	if (def?.kind !== "default")
		throw new Error("expected the ensured Default workspace pinned first");

	await expect(handleRequest("workspace.remove", { id: def.id }, CTX)).rejects.toThrow(
		"The Default workspace cannot be removed",
	);
	await expect(
		handleRequest("workspace.rename", { id: def.id, name: "Not Default" }, CTX),
	).rejects.toThrow("The Default workspace cannot be renamed");

	const after = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	expect(after.filter((w) => w.kind === "default")).toHaveLength(1);
	expect(after[0]?.id).toBe(def.id);
});

test("resource handlers scope every read/control to a registered workspace and actual parent", async () => {
	const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	const priorOffline = process.env.PI_OFFLINE;
	process.env.PI_CODING_AGENT_DIR = join(dataDir, "agent");
	process.env.PI_OFFLINE = "1";
	configurePiRuntime(
		await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			allowModelNetwork: false,
		}),
	);
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd, { id: "release.1" }));
	try {
		const workspace = (await handleRequest(
			"workspace.create",
			{ projectId: "p1" },
			CTX,
		)) as Workspace;
		const other = (await handleRequest("workspace.create", { projectId: "p1" }, CTX)) as Workspace;
		const parent = (await handleRequest(
			"session.create",
			{ workspaceId: workspace.id },
			CTX,
		)) as CreateSessionResult;
		const scope = { workspaceId: workspace.id, sessionId: parent.sessionId };
		expect(await handleRequest("session.resources", scope, CTX)).toEqual({
			...scope,
			commands: [],
			mcpServers: [],
			subagents: [],
		});
		expect(
			await handleRequest("backgroundCommand.output", { ...scope, commandId: "missing" }, CTX),
		).toEqual({ available: false });
		await expect(
			handleRequest("backgroundCommand.stop", { ...scope, commandId: "missing" }, CTX),
		).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
		const children = { workspaceId: workspace.id, parentSessionId: parent.sessionId };
		expect(await handleRequest("subagent.stopAll", children, CTX)).toEqual({
			ok: true,
			targeted: 0,
		});
		await expect(
			handleRequest("subagent.stop", { ...children, childSessionId: "missing" }, CTX),
		).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
		for (const workspaceId of [other.id, "missing-workspace"]) {
			const calls = [
				["session.resources", { ...scope, workspaceId }],
				["backgroundCommand.output", { ...scope, workspaceId, commandId: "missing" }],
				["backgroundCommand.stop", { ...scope, workspaceId, commandId: "missing" }],
				["subagent.stop", { ...children, workspaceId, childSessionId: "missing" }],
				["subagent.stopAll", { ...children, workspaceId }],
			] as const;
			for (const [method, params] of calls)
				await expect(handleRequest(method, params, CTX)).rejects.toMatchObject({
					code: "RESOURCE_UNAVAILABLE",
				});
		}
		await expect(
			handleRequest("session.resources", { ...scope, sessionId: "unknown-parent" }, CTX),
		).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
		for (const params of [
			undefined,
			null,
			{},
			{ ...scope, sessionId: "../secret" },
			{ ...scope, sessionId: 123 },
			{ ...scope, path: "/tmp/secret" },
			{ ...scope, pid: 123 },
		]) {
			await expect(handleRequest("session.resources", params, CTX)).rejects.toThrow(
				"Invalid resource ids",
			);
		}
		for (const commandId of ["/tmp/output", "..", "C:\\output", "bad\u0000id"]) {
			await expect(
				handleRequest("backgroundCommand.output", { ...scope, commandId }, CTX),
			).rejects.toThrow("Invalid resource ids");
			await expect(
				handleRequest("backgroundCommand.stop", { ...scope, commandId }, CTX),
			).rejects.toThrow("Invalid resource ids");
		}
	} finally {
		disposeAllSessions();
		configurePiRuntime(null);
		setSessionManagerFactory((cwd) => SessionManager.create(cwd));
		if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
		if (priorOffline === undefined) delete process.env.PI_OFFLINE;
		else process.env.PI_OFFLINE = priorOffline;
	}
});

test("external text files require plugin ownership and retain compare-and-swap saves", async () => {
	const [workspace] = (await handleRequest(
		"workspace.list",
		{ projectId: "p1" },
		CTX,
	)) as Workspace[];
	if (!workspace) throw new Error("expected workspace");
	const path = join(dataDir, "config.toml");
	writeFileSync(path, 'model = "fixture"\n');
	const params = { workspaceId: workspace.id, path };
	await expect(handleRequest("fs.readFile", params, CTX)).rejects.toThrow("escapes");
	setPluginRuntime(
		stubPluginRuntime({
			allowsExternalFile: (id, candidate) => id === workspace.id && candidate === path,
		}),
	);
	const { content: readContent, meta } = (await handleRequest("fs.readFile", params, CTX)) as {
		content: string;
		meta: ResourceMeta;
	};
	const read = { content: readContent, hash: meta.hash ?? "" };
	expect(read.content).toBe('model = "fixture"\n');
	const content = 'model = "updated"\n';
	expect(
		await handleRequest("fs.writeFile", { ...params, content, baseHash: read.hash }, CTX),
	).toMatchObject({ written: true });
	expect(readFileSync(path, "utf8")).toBe(content);
	expect(
		await handleRequest("fs.writeFile", { ...params, content: "stale", baseHash: read.hash }, CTX),
	).toMatchObject({ written: false, disk: { content } });
	await expect(
		handleRequest("fs.readFile", { ...params, workspaceId: "missing" }, CTX),
	).rejects.toThrow("Unknown workspace");
	await expect(
		handleRequest("fs.readFile", { ...params, path: join(dataDir, "auth.json") }, CTX),
	).rejects.toThrow("escapes");
	setPluginRuntime(null);
	await expect(
		handleRequest("fs.writeFile", { ...params, content: "disabled", baseHash: read.hash }, CTX),
	).rejects.toThrow("escapes");
	expect(readFileSync(path, "utf8")).toBe(content);
});
