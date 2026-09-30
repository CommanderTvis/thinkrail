import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, gitAs, gitText } from "../../../e2e/fixtures/git";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO, E2E_PICK_DIR_POINTER } from "../../../e2e/fixtures/paths";
import {
	chatTabs,
	createWorkspaceViaDialog,
	openAppFresh,
	openFixtureProject,
	worktreeRows,
} from "./fixtures/app";
import { expect, type NativeApp, test } from "./fixtures/native";

function seedRemoteProject(name: string, withUpstream = false) {
	const root = join(E2E_DATA_DIR, name);
	const repo = join(root, "repo");
	const origin = join(root, "origin.git");
	rmSync(root, { recursive: true, force: true });
	mkdirSync(repo, { recursive: true });
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "e2e@thinkrail.test");
	git(repo, "config", "user.name", "ThinkRail E2E");
	git(repo, "config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "README.md"), "base\n");
	git(repo, "add", "README.md");
	git(repo, "commit", "-m", "base");
	git(root, "init", "--bare", "-b", "main", origin);
	git(repo, "remote", "add", "origin", origin);
	git(repo, "push", "origin", "main");
	git(repo, "fetch", "origin");
	git(repo, "remote", "set-head", "origin", "main");
	if (withUpstream) {
		const upstream = join(root, "upstream.git");
		git(root, "init", "--bare", "-b", "trunk", upstream);
		git(repo, "remote", "add", "upstream", upstream);
		git(repo, "push", "upstream", "main:trunk");
		git(repo, "fetch", "upstream");
		git(repo, "remote", "set-head", "upstream", "trunk");
	}
	return { root, repo, origin };
}

async function openPickedProjectWorkspaceDialog(app: NativeApp, repo: string) {
	writeFileSync(E2E_PICK_DIR_POINTER, repo);
	await app.getByTestId("add-project-menu").click();
	await app.getByTestId("menu-open-project").click();
	await expect(app.getByTestId("project-item").first()).toBeShown();
	await app.getByTestId("add-workspace").first().click();
	const dialog = app.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeShown();
	return dialog;
}

function refOid(repo: string, ref: string): string | null {
	const result = spawnSync("git", ["-C", repo, "rev-parse", "--verify", ref], {
		encoding: "utf8",
	});
	return result.status === 0 ? result.stdout.trim() : null;
}

test("the dialog lists local branches (no stray origin) and creates a worktree", async ({ app }) => {
	await openFixtureProject(app);

	await app.getByTestId("add-workspace").first().click();
	const dialog = app.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeShown();

	await expect(dialog).toContainShownText("Create workspace");
	await expect(dialog).toContainShownText("A separate checkout on its own new branch");
	await expect(dialog.getByTestId("ws-prompt-note")).toHaveElements(0);
	await expect(dialog).toContainShownText("Files, chats, changes, and terminals stay scoped to it");
	await expect(dialog.getByTestId("ws-target-worktree")).toHaveAttr("active", "true");

	await dialog.getByTestId("ws-target-default").click();
	await expect(dialog).toContainShownText("Work in project folder");
	await expect(dialog).toContainShownText("no isolation");
	await expect(dialog.getByTestId("ws-branch-picker")).toHaveElements(0);
	await expect(app.getByTestId("create-workspace")).toShowText(/Start/);
	await dialog.getByTestId("ws-target-worktree").click();
	await expect(dialog).toContainShownText("Create workspace");
	await expect(dialog.getByTestId("ws-branch-picker")).toBeShown();
	await expect(app.getByTestId("create-workspace")).toShowText(/Create/);

	await expect(dialog.getByTestId("ws-project-picker")).toContainShownText("sample-project");

	const branchPicker = dialog.getByTestId("ws-branch-picker");
	await expect(branchPicker).toContainShownText("From");
	await expect(branchPicker).toContainShownText("main");

	await branchPicker.click();
	const mainOption = app.getByTestId("branch-option").withAttr("branch", "main");
	await expect(mainOption).toBeShown();
	await expect(mainOption).toContainShownText("default");
	await expect(app.getByTestId("branch-option").withAttr("branch", "origin")).toHaveElements(0);

	await app.getByTestId("branch-search").fill("zzz-no-such-branch");
	await expect(app.getByTestId("branch-option")).toHaveElements(0);
	await expect(app.getByTestId("branch-popover")).toContainShownText("No branches found.");
	await app.getByTestId("branch-search").fill("main");
	await expect(mainOption).toBeShown();
	await app.getByTestId("branch-search").press("Escape");
	await expect(app.getByTestId("branch-popover")).toHaveElements(0);

	const effort = dialog.getByTestId("thinking-selector");
	await expect(effort).toBeShown();
	const modelResolved = !(await dialog.getByTestId("model-selector").textContent())?.includes(
		"Default model",
	);
	if (modelResolved) await expect(effort).toHaveAttr("disabled", "false");
	else await expect(effort).toHaveAttr("disabled", "true");

	await dialog.getByTestId("model-selector").click();
	const refresh = app.getByTestId("model-refresh");
	await expect(refresh).toBeShown();
	await refresh.click();
	await expect(refresh).toHaveAttr("refreshing", "false");
	await refresh.press("Escape");
	await expect(refresh).toHaveElements(0);

	await dialog.getByTestId("ws-prompt").press("Escape");
	await expect(dialog).not.toBeShown();
	await expect(worktreeRows(app)).toHaveElements(0);

	await app.getByTestId("add-workspace").first().click();
	await expect(dialog).toBeShown();
	await app.getByTestId("create-workspace").click();
	await expect(dialog).not.toBeShown();
	await expect(worktreeRows(app)).toHaveElements(1);
	await expect(worktreeRows(app).first()).toHaveAttr("active", "true");

	const scope = app.getByTestId("scope-context");
	await expect(scope).toHaveAttr("context", "workspace");
	await expect(scope).toContainShownText("sample-project");
	await expect(scope).toContainShownText("workspace-1");
	await expect(scope).toContainShownText("from main");

	await expect(chatTabs(app)).toHaveElements(1);
	await expect(app.getByTestId("chat-input")).toBeShown();
	await expect(app.getByTestId("chat-message").withAttr("role", "user")).toHaveElements(0);
});

test("folder-mode Start with an empty prompt lands in a fresh chat in the Default workspace", async ({ app }) => {
	await openFixtureProject(app);
	await app.getByTestId("add-workspace").first().click();
	const dialog = app.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeShown();
	await dialog.getByTestId("ws-target-default").click();
	await app.getByTestId("create-workspace").click();
	await expect(dialog).not.toBeShown();

	await expect(app.getByTestId("scope-name")).toShowText("Default");
	await expect(worktreeRows(app)).toHaveElements(0);
	await expect(chatTabs(app)).toHaveElements(1);
	await expect(app.getByTestId("chat-input")).toBeShown();
	await expect(app.getByTestId("chat-message").withAttr("role", "user")).toHaveElements(0);
});

test("a project's committed skills are gated behind trust, then autocomplete", async ({ app }) => {
	await openFixtureProject(app);

	await app.getByTestId("add-workspace").first().click();
	const dialog = app.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeShown();
	const prompt = dialog.getByTestId("ws-prompt");
	const portable = dialog.getByTestId("slash-command").filter({ hasText: "/skill:e2e-portable" });

	await expect(dialog.getByTestId("ws-trust-notice")).toBeShown();
	await prompt.fill("/e2e");
	await expect(portable).toHaveElements(0);

	await dialog.getByTestId("ws-trust-project").click();
	await expect(dialog.getByTestId("ws-trust-notice")).not.toBeShown();
	await prompt.fill("/e2e");
	await expect(portable).toBeShown();
	await expect(portable).toContainShownText("skill/project");

	await prompt.press("Escape");
	await expect(dialog.getByTestId("slash-menu")).not.toBeShown();
	await expect(dialog).toBeShown();
	await prompt.fill("/e2");
	await expect(portable).toBeShown();

	await prompt.press("Enter");
	await expect(prompt).toHaveInputValue("/skill:e2e-portable ");
	await expect(dialog).toBeShown();
	await expect(worktreeRows(app)).toHaveElements(0);
});

test("the start prompt shares template completion and slot behavior without live-only commands", async ({ app }) => {
	const templateFile = join(E2E_FIXTURE_REPO, ".pi", "prompts", "workspace-kickoff.md");
	mkdirSync(join(E2E_FIXTURE_REPO, ".pi", "prompts"), { recursive: true });
	writeFileSync(
		templateFile,
		`---
description: Prepare a workspace task
argument-hint: "[topic] [check]"
---
Prepare $1 and verify \${2:-tests}.
`,
	);

	try {
		await openFixtureProject(app);
		await app.getByTestId("add-workspace").first().click();
		const dialog = app.getByTestId("new-workspace-dialog");
		const prompt = dialog.getByTestId("ws-prompt");

		await prompt.fill("/compact");
		await expect(dialog.getByTestId("slash-command").filter({ hasText: "/compact" })).toHaveElements(
			0,
		);

		await prompt.fill("/review");
		const globalTemplate = dialog.getByTestId("slash-command").filter({ hasText: "/review" });
		await expect(globalTemplate).toBeShown();
		await expect(globalTemplate).toContainShownText("prompt/user");

		await prompt.fill("/workspace-k");
		const projectTemplate = dialog
			.getByTestId("slash-command")
			.filter({ hasText: "/workspace-kickoff" });
		await expect(projectTemplate).toBeShown();
		await expect(projectTemplate).toContainShownText("prompt/project");
		await projectTemplate.click();

		await expect(prompt).toHaveInputValue("Prepare ⟨topic⟩ and verify tests.");
		await expect(dialog.getByTestId("slot-hint")).toContainShownText("slot 1/2");
		await prompt.pressSequentially("parser");
		await prompt.press("Tab");
		await expect(dialog.getByTestId("slot-hint")).toContainShownText("slot 2/2");

		await prompt.press("Enter");
		await expect(dialog).not.toBeShown();
		await expect(app.getByTestId("chat-message").withAttr("role", "user")).toContainShownText(
			"Prepare parser and verify tests.",
		);
	} finally {
		rmSync(templateFile, { force: true });
	}
});

test("Enter in the prompt creates; Shift+Enter inserts a newline", async ({ app }) => {
	await openFixtureProject(app);

	await app.getByTestId("add-workspace").first().click();
	const dialog = app.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeShown();
	const prompt = dialog.getByTestId("ws-prompt");

	await prompt.fill("first line");
	await expect(dialog.getByTestId("workspace-naming-hint")).toContainShownText(
		"name the workspace and branch from your request",
	);
	await prompt.press("Shift+Enter");
	await prompt.pressSequentially("second line");
	await expect(prompt).toHaveInputValue("first line\nsecond line");
	await expect(dialog).toBeShown();
	await expect(worktreeRows(app)).toHaveElements(0);

	await prompt.fill("");
	await expect(dialog.getByTestId("workspace-naming-hint")).toHaveElements(0);
	await prompt.press("Enter");
	await expect(dialog).not.toBeShown();
	await expect(worktreeRows(app)).toHaveElements(1);
	await expect(chatTabs(app)).toHaveElements(1);
	await expect(app.getByTestId("chat-message").withAttr("role", "user")).toHaveElements(0);
});

test("a base whose fetch fails reports git's error, not a request timeout", async ({ app }) => {
	const remote = join(E2E_DATA_DIR, "dangling-head-remote.git");
	const repo = join(E2E_DATA_DIR, "dangling-head-fixture");
	for (const path of [remote, repo]) rmSync(path, { recursive: true, force: true });
	mkdirSync(remote, { recursive: true });
	git(remote, "init", "--bare", "-b", "main");
	git(E2E_FIXTURE_REPO, "push", remote, "main");
	git(E2E_DATA_DIR, "clone", remote, repo);
	git(repo, "remote", "set-head", "origin", "main");
	git(repo, "update-ref", "-d", "refs/remotes/origin/main");
	rmSync(remote, { recursive: true, force: true });

	try {
		await openAppFresh(app);
		writeFileSync(E2E_PICK_DIR_POINTER, repo);
		await app.getByTestId("add-project-menu").click();
		await app.getByTestId("menu-open-project").click();
		await expect(app.getByTestId("project-item").first()).toBeShown();

		await app.getByTestId("add-workspace").first().click();
		const dialog = app.getByTestId("new-workspace-dialog");
		await expect(dialog).toBeShown();
		await expect(dialog.getByTestId("ws-branch-picker")).toContainShownText("origin/main");

		await app.getByTestId("create-workspace").click();

		const toast = app.getByTestId("toast");
		await expect(toast).toContainShownText("Couldn't create workspace");
		await expect(toast).toContainShownText("Could not fetch origin/main");
		await expect(worktreeRows(app)).toHaveElements(0);
	} finally {
		writeFileSync(E2E_PICK_DIR_POINTER, E2E_FIXTURE_REPO);
		rmSync(repo, { recursive: true, force: true });
	}
});

test("the branch picker groups by host-supplied remotes and creates from the selected ref", async ({ app }) => {
	await openAppFresh(app);
	const { repo } = seedRemoteProject("all-remotes-picker", true);
	const dialog = await openPickedProjectWorkspaceDialog(app, repo);
	await dialog.getByTestId("ws-branch-picker").click();

	const headings = app.getByTestId("branch-group");
	await expect(headings.withAttr("name", "Remote")).toBeShown();
	await expect(headings.withAttr("name", "origin")).toBeShown();
	await expect(headings.withAttr("name", "upstream")).toBeShown();
	await expect(headings.withAttr("name", "Local")).toBeShown();
	const origin = app.getByTestId("branch-option").withAttr("branch", "origin/main");
	await expect(origin).toContainShownText("main");
	await expect(origin).not.toContainShownText("origin/");
	const upstream = app.getByTestId("branch-option").withAttr("branch", "upstream/trunk");
	await expect(upstream).toContainShownText("trunk");
	await expect(upstream).not.toContainShownText("upstream/");

	await app.getByTestId("branch-search").fill("upstream/trunk");
	await expect(app.getByTestId("branch-option")).toHaveElements(1);
	await upstream.click();

	const workspace = await createWorkspaceViaDialog(app);
	expect(workspace.baseBranch).toBe("upstream/trunk");
	expect(gitText(workspace.worktreePath, "rev-parse", "HEAD").trim()).toBe(
		gitText(repo, "rev-parse", "refs/remotes/upstream/trunk").trim(),
	);
});

test("opening New Workspace prefetches a stale default before create", async ({ app }) => {
	await openAppFresh(app);
	const { root, repo, origin } = seedRemoteProject("stale-default-prefetch");
	const oldSha = gitText(repo, "rev-parse", "refs/remotes/origin/main").trim();
	const writer = join(root, "writer");
	git(root, "clone", origin, writer);
	git(writer, "config", "commit.gpgsign", "false");
	writeFileSync(join(writer, "README.md"), "new\n");
	gitAs(writer, "add", "README.md");
	gitAs(writer, "commit", "-m", "new");
	git(writer, "push", "origin", "main");
	const newSha = gitText(writer, "rev-parse", "HEAD").trim();
	expect(newSha).not.toBe(oldSha);

	const dialog = await openPickedProjectWorkspaceDialog(app, repo);
	await expect(dialog.getByTestId("ws-branch-picker")).toContainShownText("origin/main");
	await expect
		.poll(() => refOid(repo, "refs/remotes/origin/main"), { timeout: 5_000 })
		.toBe(newSha);
});

test("opening New Workspace prefetches a missing default tracking ref", async ({ app }) => {
	await openAppFresh(app);
	const { repo } = seedRemoteProject("missing-default-prefetch");
	const expectedSha = gitText(repo, "rev-parse", "HEAD").trim();
	git(repo, "update-ref", "-d", "refs/remotes/origin/main");

	const dialog = await openPickedProjectWorkspaceDialog(app, repo);
	await expect(dialog.getByTestId("ws-branch-picker")).toContainShownText("origin/main");
	await expect
		.poll(() => refOid(repo, "refs/remotes/origin/main"), { timeout: 5_000 })
		.toBe(expectedSha);
});

test("a pasted image in the workspace dialog rides along into the first chat turn", async ({ app }) => {
	await openFixtureProject(app);
	await app.getByTestId("add-workspace").first().click();
	const dialog = app.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeShown();

	await dialog.getByTestId("ws-prompt").fill("Look at this");
	await dialog.getByTestId("ws-prompt").pasteImage(640, 480);
	const chip = dialog.getByTestId("composer-image");
	await expect(chip).toHaveElements(1);
	await expect(chip).toHaveAttr("width", "640");

	await app.getByTestId("create-workspace").click();
	await expect(dialog).not.toBeShown();

	const userMessage = app.getByTestId("chat-message").withAttr("role", "user").first();
	await expect(userMessage).toBeShown();
	await expect(userMessage.getByTestId("chat-message-images")).toBeShown();
	await expect(userMessage.getByTestId("chat-attachment-chip")).toHaveElements(1);
});
