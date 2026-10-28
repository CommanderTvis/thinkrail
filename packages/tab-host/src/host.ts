import type { Credential, MutableModels, Provider } from "@earendil-works/pi-ai";
import {
	type AppConfig,
	DEFAULT_CONFIG,
	DEFAULT_GIT_CORS_PROXY,
	type FileNode,
	PROTOCOL_VERSION,
	type Project,
	type ResourceMeta,
	type SearchHit,
	type ServerWelcome,
	TAB_HOST_PROJECTS_DIR,
	type Workspace,
	WS_CHANNELS,
	type WsMethodName,
	type WsParams,
	type WsResult,
	type WsServerMessage,
} from "@thinkrail/contracts";
import type { PluginManifest } from "@thinkrail/plugin-api";
import type { PluginHostModule } from "@thinkrail/plugin-api/host";
import { basenamePath, dirnamePath, joinPath, type TabFs } from "./fs";
import * as git from "./git";
import { availableModels, createTabModels, frameForPrompt, providerStatus } from "./models";
import { TabPlugins } from "./plugins";
import { TabSessions } from "./sessions";
import { createShell } from "./shell";
import { TabTerminals } from "./terminals";
import { resolveInside } from "./tools";

const STATE_FILE = "/.thinkrail/host.json";
const TAB_CONFIG: AppConfig = {
	...DEFAULT_CONFIG,
	analyticsEnabled: false,
	analyticsConsentConfirmed: true,
};
const MAX_SEARCH_HITS = 200;

interface HostState {
	projects: Project[];
	config: AppConfig;
	credentials: Record<string, Credential>;
}

export interface TabHostOptions {
	fs: TabFs;
	/** Delivers one server frame to the page. */
	post(message: WsServerMessage): void;
	/** Called after any change worth persisting; the caller decides when to flush to durable storage. */
	persist(): void;
	plugins: { modules: readonly PluginHostModule[]; manifests: readonly PluginManifest[] };
	appVersion?: string;
	/** Providers registered beside pi-ai's builtins, such as a scripted one under test. */
	providers?: readonly Provider[];
}

type Handlers = {
	[M in WsMethodName]?: (params: WsParams<M>) => WsResult<M> | Promise<WsResult<M>>;
};

class NotInTab extends Error {}

function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "project"
	);
}

async function sha256(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MIME_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	bmp: "image/bmp",
	ico: "image/x-icon",
	svg: "image/svg+xml",
	pdf: "application/pdf",
};

function mimeFor(path: string, bytes: Uint8Array): string {
	const known = MIME_BY_EXTENSION[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
	return known ?? (isText(bytes) ? "text/plain; charset=utf-8" : "application/octet-stream");
}

function isText(bytes: Uint8Array): boolean {
	return !bytes.subarray(0, 8000).includes(0);
}

/**
 * The ThinkRail host inside a browser tab: the subset of the wire protocol a project in the tab's
 * own filesystem needs (projects, files, git, pi chats, plugins), answered without a process host.
 */
export class TabHost {
	private readonly fs: TabFs;
	private readonly state: HostState;
	private readonly models: MutableModels;
	private readonly sessions: TabSessions;
	private readonly plugins: TabPlugins;
	private readonly terminals: TabTerminals;
	private readonly logins = new Map<string, (value: string) => void>();

	constructor(private readonly options: TabHostOptions) {
		this.fs = options.fs;
		this.state = this.loadState();
		this.models = createTabModels({
			read: () => this.state.credentials,
			write: (next) => {
				this.state.credentials = next;
				this.save();
			},
		});
		for (const provider of options.providers ?? []) this.models.setProvider(provider);
		this.sessions = new TabSessions({
			fs: this.fs,
			models: this.models,
			publish: (channel, data) => this.push(channel, data),
			workspaceRoot: (workspaceId) => {
				const project = this.projectForWorkspace(workspaceId);
				return { root: project.path, projectId: project.id };
			},
			pluginTools: (cwd) => this.plugins.agentTools(cwd),
			toolRan: (workspaceId) => void this.workspaceChanged(workspaceId),
			persist: () => this.options.persist(),
		});
		this.terminals = new TabTerminals({
			publish: (channel, data) => this.push(channel, data),
			shell: (workspaceId) => {
				const project = this.projectForWorkspace(workspaceId);
				return { bash: createShell(this.fs, project.path), root: project.path, name: project.name };
			},
			commandRan: (workspaceId) => void this.workspaceChanged(workspaceId),
		});
		this.plugins = new TabPlugins(
			{
				fs: this.fs,
				publish: (channel, data) => this.push(channel, data),
				plugins: () => this.state.config.plugins,
				projects: () => this.state.projects,
				workspaces: (projectId) => this.workspaces(projectId),
				sendToSession: async (sessionId, text) => this.sessions.prompt(sessionId, text),
				persist: () => this.options.persist(),
			},
			options.plugins.modules,
			options.plugins.manifests,
		);
	}

	async start(): Promise<void> {
		this.fs.mkdirSync(TAB_HOST_PROJECTS_DIR, { recursive: true });
		this.fs.mkdirSync("/tmp", { recursive: true });
		await this.plugins.reconcile();
		this.push(WS_CHANNELS.serverWelcome, this.welcome());
	}

	private loadState(): HostState {
		const empty: HostState = { projects: [], config: TAB_CONFIG, credentials: {} };
		if (!this.fs.existsSync(STATE_FILE)) return empty;
		const loaded = JSON.parse(
			this.fs.readFileSync(STATE_FILE, "utf8") as string,
		) as Partial<HostState>;
		return {
			projects: loaded.projects ?? [],
			config: { ...TAB_CONFIG, ...loaded.config },
			credentials: loaded.credentials ?? {},
		};
	}

	private save(): void {
		this.fs.mkdirSync(dirnamePath(STATE_FILE), { recursive: true });
		this.fs.writeFileSync(STATE_FILE, JSON.stringify(this.state));
		this.options.persist();
	}

	private push(channel: string, data: unknown): void {
		this.options.post({ channel, data } as WsServerMessage);
	}

	private welcome(): ServerWelcome {
		const open = this.state.projects.filter((p) => !p.closed);
		return {
			protocolVersion: PROTOCOL_VERSION,
			...(this.options.appVersion ? { appVersion: this.options.appVersion } : {}),
			projects: open,
			recentProjects: [...this.state.projects].sort((a, b) => b.lastOpened - a.lastOpened),
			config: this.state.config,
			plugins: this.plugins.roster(),
		};
	}

	/**
	 * The bytes behind a `/files/<workspace>/<path>` or `/blob/<workspace>/<oid>/<path>` URL, which a
	 * process host serves over HTTP; in a tab the page's service worker asks for them here.
	 */
	async readBytes(pathname: string): Promise<{ bytes: Uint8Array; mime: string }> {
		const [route, workspace, ...rest] = pathname.split("/").filter(Boolean).map(decodeURIComponent);
		if (!workspace || rest.length === 0) throw new Error(`Not a file URL: ${pathname}`);
		const root = this.root(workspace);
		const oid = route === "blob" ? rest.shift() : undefined;
		const path = rest.join("/");
		const bytes =
			oid !== undefined
				? await git.readBlob(this.fs, root, oid)
				: (this.fs.readFileSync(resolveInside(root, path)) as Uint8Array);
		return { bytes, mime: mimeFor(path, bytes) };
	}

	/** Answers one request frame; the reply is posted, never thrown. */
	async handle(frame: { id: string; method: string; params: unknown }): Promise<void> {
		try {
			const result = await this.dispatch(frame.method, frame.params);
			this.options.post({ id: frame.id, ok: true, result } as WsServerMessage);
		} catch (error) {
			const err = error as Error & { code?: string };
			this.options.post({
				id: frame.id,
				ok: false,
				error: err.message,
				...(err.code === "ENOENT" ? { errorCode: "FILE_NOT_FOUND" } : {}),
			} as WsServerMessage);
		}
	}

	private async dispatch(method: string, params: unknown): Promise<unknown> {
		if (method.startsWith("plugin.")) {
			const [, id, ...rest] = method.split(".");
			return this.plugins.call(id ?? "", rest.join("."), params, { clientKey: "tab" });
		}
		const handler = (this.handlers as Record<string, ((p: unknown) => unknown) | undefined>)[
			method
		];
		if (!handler) throw new NotInTab(`${method} is not available in the ThinkRail Playground`);
		return handler(params);
	}

	private project(id: string): Project {
		const project = this.state.projects.find((p) => p.id === id);
		if (!project) throw new Error(`Unknown project ${id}`);
		return project;
	}

	private projectForWorkspace(workspaceId: string): Project {
		return this.project(workspaceId.replace(/^ws_/, ""));
	}

	private workspaceOf(project: Project, branch = "main", vcs?: Workspace["vcs"]): Workspace {
		return {
			id: `ws_${project.id}`,
			projectId: project.id,
			kind: "default",
			name: project.name,
			branch,
			worktreePath: project.path,
			baseBranch: branch,
			...(vcs ? { vcs } : {}),
		};
	}

	private workspaces(projectId?: string): Workspace[] {
		return this.state.projects
			.filter((p) => !p.closed && (projectId === undefined || p.id === projectId))
			.map((p) => this.workspaceOf(p));
	}

	private async workspace(project: Project): Promise<Workspace> {
		const repo = await git.isRepo(this.fs, project.path);
		if (!repo) return this.workspaceOf(project, "main", "none");
		const branch = await git.currentBranch(this.fs, project.path);
		return this.workspaceOf(
			project,
			branch,
			(await git.hasCommits(this.fs, project.path)) ? undefined : "unborn",
		);
	}

	private addProject(path: string): Project {
		const existing = this.state.projects.find((p) => p.path === path);
		if (existing) {
			delete existing.closed;
			existing.lastOpened = Date.now();
			this.save();
			this.push(WS_CHANNELS.projectUpdated, existing);
			return existing;
		}
		const name = basenamePath(path);
		let id = slugify(name);
		while (this.state.projects.some((p) => p.id === id)) id = `${id}-1`;
		const project: Project = {
			id,
			name,
			path,
			slug: id,
			lastOpened: Date.now(),
			trusted: true,
			hasGit: this.fs.existsSync(joinPath(path, ".git")),
		};
		this.state.projects.push(project);
		this.save();
		this.push(WS_CHANNELS.projectUpdated, project);
		return project;
	}

	private freshProjectPath(parentPath: string, name: string): string {
		if (!name.trim()) throw new Error("Name the project");
		const path = joinPath(parentPath || TAB_HOST_PROJECTS_DIR, name.trim());
		if (this.fs.existsSync(path)) throw new Error(`${path} already exists`);
		return path;
	}

	private root(workspaceId: string): string {
		return this.projectForWorkspace(workspaceId).path;
	}

	private async meta(bytes: Uint8Array): Promise<ResourceMeta> {
		return { hash: await sha256(bytes), byteLength: bytes.byteLength, text: isText(bytes) };
	}

	private changed(workspaceId: string, paths: string[]): void {
		const payload = {
			workspaceId,
			paths,
			truncated: paths.length === 0,
			skillChange: "none" as const,
		};
		this.push(WS_CHANNELS.workspaceFsChanged, payload);
		this.plugins.fsChanged(payload);
		this.options.persist();
	}

	/** After the agent touched a workspace: tell clients its files may have changed and re-read its git state. */
	private async workspaceChanged(workspaceId: string): Promise<void> {
		this.changed(workspaceId, []);
		const workspace = await this.workspace(this.projectForWorkspace(workspaceId));
		this.push(WS_CHANNELS.workspaceUpdated, workspace);
		this.plugins.workspaceEvent({ kind: "updated", workspace });
	}

	private search(root: string, query: string): SearchHit[] {
		const needle = query.toLowerCase();
		const hits: SearchHit[] = [];
		const walk = (dir: string) => {
			for (const name of (this.fs.readdirSync(dir) as string[]).sort()) {
				if (hits.length >= MAX_SEARCH_HITS) return;
				if (name === ".git" || name === "node_modules") continue;
				const path = joinPath(dir, name);
				if (this.fs.statSync(path).isDirectory()) {
					walk(path);
					continue;
				}
				const bytes = this.fs.readFileSync(path) as Uint8Array;
				if (!isText(bytes)) continue;
				new TextDecoder()
					.decode(bytes)
					.split("\n")
					.forEach((text, index) => {
						if (hits.length < MAX_SEARCH_HITS && text.toLowerCase().includes(needle))
							hits.push({ path: path.slice(root.length + 1), line: index + 1, text });
					});
			}
		};
		walk(root);
		return hits;
	}

	private readonly handlers: Handlers = {
		"project.list": () => this.state.projects.filter((p) => !p.closed),
		"project.open": ({ path }) => this.addProject(joinPath(path)),
		"project.close": ({ id }) => {
			const project = this.project(id);
			project.closed = true;
			this.save();
			this.push(WS_CHANNELS.projectUpdated, project);
			return { ok: true };
		},
		"project.rename": ({ id, name }) => {
			const project = this.project(id);
			project.name = name.trim() || project.name;
			this.save();
			this.push(WS_CHANNELS.projectUpdated, project);
			return project;
		},
		"project.delete": ({ id }) => {
			const project = this.project(id);
			const workspaceId = `ws_${project.id}`;
			for (const session of this.sessions.list(workspaceId))
				this.sessions.delete(workspaceId, session.sessionId);
			this.fs.rmSync(project.path, { recursive: true, force: true });
			this.state.projects = this.state.projects.filter((candidate) => candidate.id !== id);
			this.save();
			this.push(WS_CHANNELS.workspaceRemoved, { projectId: id, id: workspaceId });
			this.push(WS_CHANNELS.serverWelcome, this.welcome());
			return { ok: true };
		},
		"project.inspect": ({ path }) => {
			if (!this.fs.existsSync(path)) return { kind: "missing" };
			if (!this.fs.statSync(path).isDirectory()) return { kind: "notDirectory" };
			return { kind: this.fs.existsSync(joinPath(path, ".git")) ? "repo" : "initable" };
		},
		"project.init": async ({ path }) => {
			await git.init(this.fs, path);
			return this.addProject(path);
		},
		"project.create": async ({ parentPath, name }) => {
			const path = this.freshProjectPath(parentPath, name);
			this.fs.mkdirSync(path, { recursive: true });
			await git.init(this.fs, path);
			return this.addProject(path);
		},
		"project.cloneDestination": ({ parentPath, name }) => ({
			path: this.freshProjectPath(parentPath, name),
		}),
		"project.cancelClone": () => ({ ok: true }),
		"project.clone": async ({ url, parentPath, name, depth, corsProxy }) => {
			const path = this.freshProjectPath(parentPath, name);
			try {
				await git.clone(this.fs, {
					url,
					dir: path,
					corsProxy: corsProxy ?? DEFAULT_GIT_CORS_PROXY,
					depth: depth ?? 50,
				});
			} catch (error) {
				this.fs.rmSync(path, { recursive: true, force: true });
				throw new Error(`Clone failed: ${(error as Error).message}`);
			}
			return this.addProject(path);
		},
		"project.hasSpecs": ({ projectId }) => ({
			hasSpecs: this.fs.existsSync(joinPath(this.project(projectId).path, "SPEC.md")),
		}),
		"project.skills": () => [],
		"project.trustSummary": () => ({ aliasSkills: [], piResources: [] }),
		"project.setTrust": ({ id }) => this.project(id),
		"project.aliasSkills": () => [],
		"dialog.selectDirectory": () => ({ path: TAB_HOST_PROJECTS_DIR }),

		"workspace.list": async ({ projectId }) => [await this.workspace(this.project(projectId))],
		"workspace.listExisting": () => [],
		"workspace.watchReady": () => ({ startupNudge: false }),
		"workspace.turns": () => ({ turns: [] }),
		"workspace.openReview": () => null,
		"editor.list": () => [],

		"fs.readDir": ({ workspaceId, path }) => {
			const root = this.root(workspaceId);
			const dir = resolveInside(root, path || ".");
			return (this.fs.readdirSync(dir) as string[])
				.filter((name) => name !== ".git")
				.map((name): FileNode => {
					const full = joinPath(dir, name);
					return {
						path: full.slice(root.length + 1),
						name,
						kind: this.fs.statSync(full).isDirectory() ? "dir" : "file",
					};
				})
				.sort((a, b) =>
					a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
				);
		},
		"fs.readFile": async ({ workspaceId, path }) => {
			const bytes = this.fs.readFileSync(resolveInside(this.root(workspaceId), path)) as Uint8Array;
			const meta = await this.meta(bytes);
			return { content: meta.text ? new TextDecoder().decode(bytes) : "", meta };
		},
		"fs.writeFile": async ({ workspaceId, path, content, baseHash }) => {
			const full = resolveInside(this.root(workspaceId), path);
			if (this.fs.existsSync(full)) {
				const disk = this.fs.readFileSync(full) as Uint8Array;
				const hash = await sha256(disk);
				if (baseHash && hash !== baseHash)
					return { written: false, disk: { content: new TextDecoder().decode(disk), hash } };
			}
			this.fs.mkdirSync(dirnamePath(full), { recursive: true });
			this.fs.writeFileSync(full, content);
			this.changed(workspaceId, [path]);
			return { written: true, hash: await sha256(new TextEncoder().encode(content)) };
		},
		"fs.createPath": ({ workspaceId, path, kind }) => {
			const full = resolveInside(this.root(workspaceId), path);
			if (this.fs.existsSync(full)) throw new Error(`${path} already exists`);
			this.fs.mkdirSync(kind === "dir" ? full : dirnamePath(full), { recursive: true });
			if (kind === "file") this.fs.writeFileSync(full, "");
			this.changed(workspaceId, [path]);
			return { ok: true };
		},
		"fs.renamePath": ({ workspaceId, path, to }) => {
			const root = this.root(workspaceId);
			const target = resolveInside(root, to);
			if (this.fs.existsSync(target)) throw new Error(`${to} already exists`);
			this.fs.mkdirSync(dirnamePath(target), { recursive: true });
			this.fs.renameSync(resolveInside(root, path), target);
			this.changed(workspaceId, [path, to]);
			return { ok: true };
		},
		"fs.trashPath": ({ workspaceId, path }) => {
			this.fs.rmSync(resolveInside(this.root(workspaceId), path), { recursive: true, force: true });
			this.changed(workspaceId, [path]);
			return { ok: true };
		},
		"fs.search": ({ workspaceId, query }) => {
			if (!query) return { hits: [], truncated: false };
			const hits = this.search(this.root(workspaceId), query);
			return { hits, truncated: hits.length >= MAX_SEARCH_HITS };
		},

		"git.status": async ({ workspaceId }) => {
			const root = this.root(workspaceId);
			if (!(await git.isRepo(this.fs, root))) return { branch: "", changes: [] };
			return git.status(this.fs, root);
		},
		"git.diffFile": async ({ workspaceId, path }) => {
			const root = this.root(workspaceId);
			const original = await git.headText(this.fs, root, path);
			const full = resolveInside(root, path);
			const bytes = this.fs.existsSync(full)
				? (this.fs.readFileSync(full) as Uint8Array)
				: new Uint8Array();
			const originalBytes = new TextEncoder().encode(original.text);
			return {
				original: original.text,
				modified: new TextDecoder().decode(bytes),
				originalOid: original.oid,
				meta: { original: await this.meta(originalBytes), modified: await this.meta(bytes) },
			};
		},
		"git.listCommits": async ({ workspaceId }) => ({
			commits: await git.listCommits(this.fs, this.root(workspaceId)),
		}),
		"git.listBranches": ({ projectId }) => git.listBranches(this.fs, this.project(projectId).path),
		"git.branchDetails": () => ({ branches: [] }),
		"git.prefetch": () => ({ ok: false }),
		"git.fetchRemotes": () => ({}),
		"github.authStatus": () => ({ connected: false }),

		"session.create": ({ workspaceId, model, thinkingLevel }) =>
			this.sessions.create(
				workspaceId,
				model ?? this.state.config.defaultModel ?? null,
				thinkingLevel ?? this.state.config.defaultEffort ?? "medium",
			),
		"session.list": ({ workspaceId }) => this.sessions.list(workspaceId),
		"session.stateList": () => this.sessions.states(),
		"session.activityList": () => [],
		"session.getMessages": ({ sessionId }) => this.sessions.messages(sessionId),
		"session.prompt": async ({ sessionId, text }) => {
			await this.sessions.prompt(sessionId, text);
			return { ok: true };
		},
		"session.steer": ({ sessionId, text }) => {
			this.sessions.steer(sessionId, text);
			return { ok: true };
		},
		"session.followUp": ({ sessionId, text }) => {
			this.sessions.followUp(sessionId, text);
			return { ok: true };
		},
		"session.nudge": async ({ sessionId, text }) => {
			await this.sessions.prompt(sessionId, text);
			return { disposition: "prompted" };
		},
		"session.abort": ({ sessionId }) => {
			this.sessions.abort(sessionId);
			return { ok: true };
		},
		"session.acknowledgeCompletion": ({ sessionId }) => this.sessions.acknowledge(sessionId),
		"session.setModel": ({ sessionId, model }) => {
			this.sessions.setModel(sessionId, model);
			return { ok: true };
		},
		"session.setThinkingLevel": ({ sessionId, level }) => {
			this.sessions.setThinkingLevel(sessionId, level);
			return { ok: true };
		},
		"session.rename": ({ sessionId, title }) => {
			this.sessions.rename(sessionId, title);
			return { ok: true };
		},
		"session.delete": ({ workspaceId, sessionId }) => {
			this.sessions.delete(workspaceId, sessionId);
			return { ok: true };
		},
		"session.dispose": () => ({ ok: true }),
		"session.getStats": ({ sessionId }) => this.sessions.stats(sessionId),
		"session.getCommands": () => [],
		"session.resources": ({ workspaceId, sessionId }) => ({
			workspaceId,
			sessionId,
			commands: [],
			subagents: [],
		}),
		"skill.list": () => [],
		"skills.state": () => [],
		"extension.list": () => [],
		"template.list": () => ({ templates: [] }),
		"terminal.list": ({ workspaceId }) => ({ tabs: this.terminals.list(workspaceId) }),
		"terminal.reserve": ({ workspaceId, tabKey, title }) => ({
			tab: this.terminals.reserve(workspaceId, tabKey, title),
		}),
		"terminal.attach": ({ workspaceId, tabKey, title }) =>
			this.terminals.attach(workspaceId, tabKey, title),
		"terminal.write": ({ id, data }) => {
			this.terminals.write(id, data);
			return { ok: true };
		},
		"terminal.resize": () => ({ ok: true }),
		"terminal.rename": ({ workspaceId, tabKey, title }) => {
			this.terminals.rename(workspaceId, tabKey, title);
			return {};
		},
		"terminal.close": ({ workspaceId, tabKey }) => this.terminals.close(workspaceId, tabKey),
		"todo.list": () => ({ todos: [], groups: [] }),
		"history.search": () => ({
			prompts: [],
			messages: [],
			promptTotal: 0,
			messageTotal: 0,
			indexing: false,
		}),

		"model.list": () => availableModels(this.models),
		"model.refresh": async () => ({ models: await availableModels(this.models), complete: true }),
		"model.default": async () => {
			const models = await availableModels(this.models);
			const configured = this.state.config.defaultModel;
			const model =
				models.find((m) => m.provider === configured?.provider && m.id === configured?.id) ??
				models[0] ??
				null;
			return { model, thinkingLevel: this.state.config.defaultEffort ?? "medium" };
		},
		"model.contextSettings": () => [],
		"model.clampThinking": ({ level }) => ({ level }),
		"provider.status": () => providerStatus(this.models),
		"provider.loginStart": ({ providerId, type }) => {
			const loginId = `login_${Date.now().toString(36)}`;
			const frame = (data: unknown) =>
				this.push(WS_CHANNELS.providerLogin, { loginId, providerId, frame: data });
			void this.models
				.login(providerId, type ?? "api_key", {
					prompt: (prompt) =>
						new Promise<string>((resolve) => {
							this.logins.set(loginId, resolve);
							frame(frameForPrompt(prompt));
						}),
					notify: (event) => {
						if (event.type === "progress" || event.type === "info")
							frame({ kind: "progress", message: event.message });
					},
				})
				.then(
					() => {
						frame({ kind: "success" });
						this.push(WS_CHANNELS.providerChanged, {});
					},
					(error: Error) => frame({ kind: "error", message: error.message }),
				)
				.finally(() => this.logins.delete(loginId));
			return { loginId };
		},
		"provider.loginReply": ({ loginId, value }) => {
			this.logins.get(loginId)?.(value);
			return { ok: true };
		},
		"provider.loginCancel": ({ loginId }) => {
			this.logins.delete(loginId);
			return { ok: true };
		},
		"provider.logout": async ({ providerId }) => {
			await this.models.logout(providerId);
			this.push(WS_CHANNELS.providerChanged, {});
			return { ok: true };
		},

		"settings.update": async ({ config }) => {
			const { plugins, ...rest } = config as Partial<AppConfig> & {
				plugins?: AppConfig["plugins"];
			};
			this.state.config = {
				...this.state.config,
				...rest,
				...(plugins ? { plugins: { ...this.state.config.plugins, ...plugins } } : {}),
			} as AppConfig;
			this.save();
			if (plugins) {
				await this.plugins.reconcile();
				this.push(WS_CHANNELS.pluginsChanged, this.plugins.roster());
			}
			this.push(WS_CHANNELS.settingsChanged, this.state.config);
			return this.state.config;
		},
		"plugins.list": () => this.plugins.roster(),
		"plugins.rescan": () => this.plugins.roster(),
		"plugins.retry": async () => {
			await this.plugins.reconcile();
			return this.plugins.roster();
		},
	};
}
