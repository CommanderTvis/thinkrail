import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	closeProject,
	createProject,
	initProject,
	inspectProjectPath,
	isProjectTrusted,
	listProjects,
	listRecentProjects,
	openProject,
	setProjectPublisher,
	setProjectTrust,
} from "./projects";

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function makeRepo(path: string): void {
	mkdirSync(path, { recursive: true });
	git(path, "init", "-b", "main");
	git(path, "config", "user.email", "t@thinkrail.test");
	git(path, "config", "user.name", "test");
	git(path, "config", "commit.gpgsign", "false");
	writeFileSync(join(path, "README.md"), "# repo\n");
	git(path, "add", "-A");
	git(path, "commit", "-m", "init");
}

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-proj-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
});

afterEach(() => {
	setProjectPublisher(null);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

/**
 * `initProject` commits into a repo it just created, so it inherits the developer's global git config —
 * including signing, which is gated behind a hardware unlock on some machines. Pin both.
 */
function withGitIdentity<T>(run: () => T): T {
	const config = join(dataDir, "test-gitconfig");
	writeFileSync(
		config,
		"[user]\n\tname = test\n\temail = t@thinkrail.test\n[commit]\n\tgpgsign = false\n",
	);
	const saved = process.env.GIT_CONFIG_GLOBAL;
	process.env.GIT_CONFIG_GLOBAL = config;
	try {
		return run();
	} finally {
		if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
		else process.env.GIT_CONFIG_GLOBAL = saved;
	}
}

function seedWorkspace(worktreePath: string, kind?: "default" | "external"): void {
	const projectsPath = join(dataDir, "projects.json");
	const existing = existsSync(projectsPath)
		? (JSON.parse(readFileSync(projectsPath, "utf8")) as unknown[])
		: [];
	writeFileSync(
		projectsPath,
		JSON.stringify([
			...existing,
			{ id: "p-other", name: "other", path: join(dataDir, "other"), slug: "other", lastOpened: 1 },
		]),
	);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "ws-1",
				projectId: "p-other",
				name: "seeded",
				branch: "feature/seeded",
				worktreePath,
				baseBranch: "main",
				renamed: true,
				...(kind ? { kind } : {}),
			},
		]),
	);
}

test("openProject refuses a checkout already attached as an external workspace", () => {
	const attached = join(dataDir, "auth checkout");
	makeRepo(attached);
	seedWorkspace(attached, "external");

	expect(() => openProject(attached)).toThrow("already open in ThinkRail");
	expect(listProjects().map((p) => p.id)).toEqual(["p-other"]);
});

test("a workspace orphaned by its project's removal no longer claims the folder", () => {
	const attached = join(dataDir, "freed checkout");
	makeRepo(attached);
	seedWorkspace(attached, "external");
	// The project the row belonged to is gone; the row is leftover state, not a claim.
	writeFileSync(join(dataDir, "projects.json"), JSON.stringify([]));

	expect(openProject(attached).path).toBe(realpathSync(attached));
});

test("a ThinkRail-managed worktree dir stays refused even when its record is orphaned", () => {
	const repo = join(dataDir, "repo-orphan");
	makeRepo(repo);
	const managed = join(dataDir, "worktrees", "repo-orphan", "workspace-1");
	git(repo, "worktree", "add", "-b", "workspace-1", managed);
	seedWorkspace(managed);
	writeFileSync(join(dataDir, "projects.json"), JSON.stringify([]));

	expect(() => openProject(managed)).toThrow("already open in ThinkRail");
});

test("openProject refuses a ThinkRail-managed worktree dir, whatever symlinks the path carries", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const managed = join(dataDir, "worktrees", "repo", "workspace-1");
	git(repo, "worktree", "add", "-b", "workspace-1", managed);
	seedWorkspace(managed);

	expect(() => openProject(managed)).toThrow("already open in ThinkRail");
	expect(openProject(repo).path).toBe(realpathSync(repo));
});

test("openProject still reopens a closed project whose own Default workspace holds its cwd", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const project = openProject(repo);
	seedWorkspace(project.path, "default");
	closeProject(project.id);

	expect(openProject(repo).id).toBe(project.id);
	expect(listProjects().map((p) => p.id)).toContain(project.id);
});

test("inspectProjectPath: a path that doesn't exist is `missing`", () => {
	expect(inspectProjectPath(join(dataDir, "nope"))).toEqual({ kind: "missing" });
});

test("inspectProjectPath: a file is `notDirectory`", () => {
	const file = join(dataDir, "a-file.txt");
	writeFileSync(file, "not a dir\n");
	expect(inspectProjectPath(file)).toEqual({ kind: "notDirectory" });
});

test("inspectProjectPath: a plain directory is `initable`", () => {
	const dir = join(dataDir, "plain");
	mkdirSync(dir);
	expect(inspectProjectPath(dir)).toEqual({ kind: "initable" });
});

test("inspectProjectPath: a git repo (and any subdirectory) is `repo`", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const sub = join(repo, "src", "deep");
	mkdirSync(sub, { recursive: true });
	expect(inspectProjectPath(repo)).toEqual({ kind: "repo" });
	expect(inspectProjectPath(sub)).toEqual({ kind: "repo" });
});

test("host-home paths resolve consistently across inspect and open", () => {
	const home = join(dataDir, "host-home");
	const repo = join(home, "repo");
	const plain = join(home, "plain");
	makeRepo(repo);
	mkdirSync(plain);
	const savedHome = process.env.HOME;
	const savedUserProfile = process.env.USERPROFILE;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		expect(inspectProjectPath("~")).toEqual({ kind: "initable" });
		expect(inspectProjectPath("~/repo")).toEqual({ kind: "repo" });
		expect(openProject("~/repo").path).toBe(realpathSync(repo));
		expect(inspectProjectPath("~/plain")).toEqual({ kind: "initable" });
		expect(openProject("~/plain").path).toBe(realpathSync(plain));
	} finally {
		if (savedHome === undefined) delete process.env.HOME;
		else process.env.HOME = savedHome;
		if (savedUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = savedUserProfile;
	}
});

test("relative project paths are rejected instead of using the host process cwd", () => {
	for (const operation of [openProject, inspectProjectPath, initProject]) {
		expect(() => operation("relative/project")).toThrow("must be absolute or start with ~/");
	}
});

test("openProject opens a plain folder directly — no git-init, no dialog needed", () => {
	const dir = join(dataDir, "plain");
	mkdirSync(dir);
	writeFileSync(join(dir, "hello.txt"), "hi\n");

	const project = openProject(dir);
	expect(project.path).toBe(realpathSync(dir));
	expect(project.hasGit).toBe(false);
	expect(existsSync(join(dir, ".git"))).toBe(false);
	expect(listProjects()).toHaveLength(1);
});

test("openProject stamps hasGit false, and a real repo omits the field entirely", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	expect(openProject(repo).hasGit).toBeUndefined();
});

test("reopening a plain folder that later became a real repo picks up hasGit again", () => {
	const dir = join(dataDir, "later-git");
	mkdirSync(dir);
	const first = openProject(dir);
	expect(first.hasGit).toBe(false);

	makeRepo(dir);
	const second = openProject(dir);
	expect(second.id).toBe(first.id);
	expect(second.hasGit).toBeUndefined();
});

test("openProject refuses a path that doesn't exist or isn't a folder", () => {
	expect(() => openProject(join(dataDir, "nope"))).toThrow("No such folder");
	const file = join(dataDir, "a-file.txt");
	writeFileSync(file, "not a dir\n");
	expect(() => openProject(file)).toThrow("Not a folder");
});

test("legacy project records default to open in both projections", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "legacy", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);

	expect(listProjects().map((project) => project.id)).toEqual(["legacy"]);
	expect(listRecentProjects().map((project) => project.id)).toEqual(["legacy"]);
});

test("close/reopen preserves the stable project identity and workspace associations", async () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const project = openProject(repo);
	const workspaceRecord = { id: "ws1", projectId: project.id, worktreePath: "/kept" };
	writeFileSync(join(dataDir, "workspaces.json"), JSON.stringify([workspaceRecord]));

	const published: Array<{ id: string; closed?: true }> = [];
	setProjectPublisher((snapshot) => published.push(snapshot));
	const closed = closeProject(project.id);

	expect(closed.closed).toBe(true);
	expect(listProjects()).toEqual([]);
	expect(listRecentProjects().map(({ id, closed: state }) => ({ id, closed: state }))).toEqual([
		{ id: project.id, closed: true },
	]);
	expect(JSON.parse(readFileSync(join(dataDir, "workspaces.json"), "utf8"))).toEqual([
		workspaceRecord,
	]);
	expect(published).toEqual([expect.objectContaining({ id: project.id, closed: true })]);

	await Bun.sleep(2);
	const reopened = openProject(repo);
	expect(reopened.id).toBe(project.id);
	expect(reopened.closed).toBeUndefined();
	expect(reopened.lastOpened).toBeGreaterThan(closed.lastOpened);
	expect(listProjects().map((candidate) => candidate.id)).toEqual([project.id]);
	expect(listRecentProjects().map((candidate) => candidate.id)).toEqual([project.id]);
	expect(published).toEqual([
		expect.objectContaining({ id: project.id, closed: true }),
		expect.not.objectContaining({ closed: true }),
	]);
});

test("closeProject rejects an unknown id instead of reporting a success with no lifecycle event", () => {
	const published: string[] = [];
	setProjectPublisher((snapshot) => published.push(snapshot.id));
	expect(() => closeProject("missing")).toThrow("Unknown project: missing");
	expect(published).toEqual([]);
});

test("setProjectTrust: persists a revocable, fail-closed trust decision", () => {
	const repo = join(dataDir, "repo");
	makeRepo(repo);
	const project = openProject(repo);

	expect(project.trusted).toBeUndefined();
	expect(isProjectTrusted(project.id)).toBe(false);

	const trusted = setProjectTrust(project.id, true);
	expect(trusted.trusted).toBe(true);
	expect(isProjectTrusted(project.id)).toBe(true);
	expect(listProjects().find((p) => p.id === project.id)?.trusted).toBe(true);

	setProjectTrust(project.id, false);
	expect(isProjectTrusted(project.id)).toBe(false);
	expect(() => setProjectTrust("nope", true)).toThrow();
});

test("createProject creates the folder, inits a repo with a root commit, and opens it", () => {
	const project = withGitIdentity(() => createProject(dataDir, "Lightbulb App"));

	expect(project.name).toBe("Lightbulb App");
	expect(project.slug).toBe("lightbulb-app");
	expect(project.hasGit).toBeUndefined();
	expect(existsSync(join(dataDir, "Lightbulb App", ".git"))).toBe(true);
	expect(listProjects().map((p) => p.id)).toEqual([project.id]);

	// The whole point of the root commit: every git-backed surface has a revision to resolve.
	const head = Bun.spawnSync(["git", "-C", project.path, "rev-parse", "--verify", "HEAD"]);
	expect(head.success).toBe(true);
	const branch = Bun.spawnSync(["git", "-C", project.path, "rev-parse", "--abbrev-ref", "HEAD"]);
	expect(branch.stdout.toString().trim()).toBe("main");
	const tracked = Bun.spawnSync(["git", "-C", project.path, "ls-files"]);
	expect(tracked.stdout.toString().trim()).toBe("");
});

test("createProject still yields a usable project when git has no identity to commit with", () => {
	// A global config with no user.name/user.email: `git commit` fails, and the project must survive it.
	const empty = join(dataDir, "empty-gitconfig");
	writeFileSync(empty, "");
	const saved = process.env.GIT_CONFIG_GLOBAL;
	process.env.GIT_CONFIG_GLOBAL = empty;
	try {
		const project = createProject(dataDir, "no-identity");

		expect(existsSync(join(project.path, ".git"))).toBe(true);
		expect(listProjects().map((p) => p.id)).toEqual([project.id]);
	} finally {
		if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
		else process.env.GIT_CONFIG_GLOBAL = saved;
	}
});

test("createProject refuses a name that would escape its parent, or reach an existing folder", () => {
	mkdirSync(join(dataDir, "taken"));

	for (const name of ["../escape", "nested/deep", ".", "..", "   ", ""]) {
		expect(() => createProject(dataDir, name)).toThrow(/Not a usable folder name/);
	}
	expect(() => createProject(dataDir, "taken")).toThrow(/Already exists/);
	expect(() => createProject(join(dataDir, "nope"), "x")).toThrow(/No such folder/);
	expect(listProjects()).toEqual([]);
});

test("createProject trims the typed name rather than creating a folder with edge whitespace", () => {
	const project = withGitIdentity(() => createProject(dataDir, "  spaced  "));

	expect(project.name).toBe("spaced");
	expect(existsSync(join(dataDir, "spaced"))).toBe(true);
});
