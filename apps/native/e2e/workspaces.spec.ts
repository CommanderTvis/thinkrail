import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, gitText } from "../../../e2e/fixtures/git";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO, E2E_PICK_DIR_POINTER } from "../../../e2e/fixtures/paths";
import {
	createWorkspaceViaDialog,
	openAppFresh,
	openFixtureProject,
	openWorkspaceMenu,
	waitConnected,
	worktreeRows,
} from "./fixtures/app";
import { expect, test } from "./fixtures/native";

test("opens and safely forgets an existing user-owned worktree", async ({ app }) => {
	await openAppFresh(app);
	const external = join(E2E_DATA_DIR, "existing-worktree-fixture");
	const detached = join(E2E_DATA_DIR, "detached-worktree-fixture");
	rmSync(external, { recursive: true, force: true });
	rmSync(detached, { recursive: true, force: true });
	git(E2E_FIXTURE_REPO, "worktree", "add", external, "-b", "feature/existing", "main");
	git(E2E_FIXTURE_REPO, "worktree", "add", "--detach", detached, "main");
	writeFileSync(join(external, "staged.txt"), "preserve this staged addition\n");
	git(external, "add", "staged.txt");
	writeFileSync(
		join(external, "README.md"),
		`${readFileSync(join(external, "README.md"), "utf8")}preserve this unstaged edit\n`,
	);
	writeFileSync(join(external, "uncommitted.txt"), "preserve this untracked file\n");

	const before = {
		status: gitText(external, "status", "--porcelain=v1", "-z"),
		branch: gitText(external, "symbolic-ref", "--short", "HEAD"),
		head: gitText(external, "rev-parse", "HEAD"),
		registry: gitText(E2E_FIXTURE_REPO, "worktree", "list", "--porcelain", "-z"),
	};
	const expectCheckoutUnchanged = () => {
		expect(gitText(external, "status", "--porcelain=v1", "-z")).toBe(before.status);
		expect(gitText(external, "symbolic-ref", "--short", "HEAD")).toBe(before.branch);
		expect(gitText(external, "rev-parse", "HEAD")).toBe(before.head);
		expect(gitText(E2E_FIXTURE_REPO, "worktree", "list", "--porcelain", "-z")).toBe(
			before.registry,
		);
	};

	writeFileSync(
		join(E2E_DATA_DIR, "projects.json"),
		JSON.stringify([
			{
				id: "fixture-project",
				name: "sample-project",
				path: E2E_FIXTURE_REPO,
				slug: "sample-project",
				lastOpened: Date.now(),
			},
		]),
	);
	await app.relaunch({ keepPreferences: true });
	await waitConnected(app);

	try {
		const projectRow = app.getByTestId("project-item").filter({ hasText: "sample-project" });
		await expect(projectRow).toBeShown();
		await projectRow.click({ button: "right" });
		await app.getByTestId("project-menu-open-existing-worktree").click();

		const dialog = app.getByTestId("existing-worktree-dialog");
		await expect(dialog).toBeShown();
		const available = dialog
			.getByTestId("existing-worktree-candidate")
			.filter({ hasText: "feature/existing" });
		await expect(available).toContainShownText(external);
		const detachedRow = dialog.getByTestId("existing-worktree-candidate").withAttr("status", "detached");
		await expect(detachedRow).toContainShownText("Detached HEAD");
		await expect(detachedRow).toContainShownText("Create a branch");
		await expect(detachedRow).toHaveAttr("disabled", "true");

		await available.click();
		await expect(dialog).toHaveElements(0);
		const row = app.getByTestId("workspace-item").withAttr("kind", "external").withAttr("active", "true");
		await expect(row).toContainShownText("existing-worktree-fixture");
		await expect(row).toContainShownText("feature/existing");
		await expect(row).not.toContainShownText(/\+\d+\s+−\d+/);
		const receipt = app.getByTestId("workspace-ready");
		await expect(receipt).toContainShownText("Existing worktree");
		await expect(receipt).toContainShownText("on feature/existing");
		expectCheckoutUnchanged();

		await openWorkspaceMenu(row);
		await expect(app.getByTestId("workspace-rename")).toHaveElements(0);
		await expect(app.getByTestId("workspace-remove")).toShowText("Remove from ThinkRail");
		await app.getByTestId("workspace-remove").click();
		const confirm = app.getByTestId("confirm-dialog").filter({ hasText: "Remove existing-worktree-fixture from ThinkRail?" });
		await expect(confirm).toContainShownText("existing checkout, files, and branch");
		await expect(confirm).toContainShownText("stay untouched");
		await app.getByTestId("confirm-remove").click();
		await expect(row).toHaveElements(0);

		expect(existsSync(external)).toBe(true);
		expect(readFileSync(join(external, "uncommitted.txt"), "utf8")).toBe(
			"preserve this untracked file\n",
		);
		expectCheckoutUnchanged();
	} finally {
		for (const path of [external, detached]) {
			try {
				git(E2E_FIXTURE_REPO, "worktree", "remove", "--force", path);
			} catch {
				rmSync(path, { recursive: true, force: true });
			}
		}
		try {
			git(E2E_FIXTURE_REPO, "branch", "-D", "feature/existing");
		} catch {}
		git(E2E_FIXTURE_REPO, "worktree", "prune");
	}
});

test("an attached worktree cannot also be opened as a project", async ({ app }) => {
	await openFixtureProject(app);
	const external = join(E2E_DATA_DIR, "claimed-worktree-fixture");
	rmSync(external, { recursive: true, force: true });
	git(E2E_FIXTURE_REPO, "worktree", "add", external, "-b", "feature/claimed", "main");

	try {
		const projectRow = app.getByTestId("project-item").filter({ hasText: "sample-project" });
		await projectRow.click({ button: "right" });
		await app.getByTestId("project-menu-open-existing-worktree").click();
		const dialog = app.getByTestId("existing-worktree-dialog");
		await dialog
			.getByTestId("existing-worktree-candidate")
			.filter({ hasText: "feature/claimed" })
			.click();
		await expect(dialog).toHaveElements(0);
		await expect(app.getByTestId("workspace-item").withAttr("kind", "external")).toHaveElements(1);

		writeFileSync(E2E_PICK_DIR_POINTER, external);
		await app.getByTestId("add-project-menu").click();
		await app.getByTestId("menu-open-project").click();

		const error = app.getByTestId("open-error-dialog");
		await expect(error).toBeShown();
		await expect(error).toContainShownText("already open in ThinkRail as a workspace");
		await expect(app.getByTestId("project-item")).toHaveElements(1);
	} finally {
		writeFileSync(E2E_PICK_DIR_POINTER, E2E_FIXTURE_REPO);
		try {
			git(E2E_FIXTURE_REPO, "worktree", "remove", "--force", external);
		} catch {
			rmSync(external, { recursive: true, force: true });
		}
		try {
			git(E2E_FIXTURE_REPO, "branch", "-D", "feature/claimed");
		} catch {}
		git(E2E_FIXTURE_REPO, "worktree", "prune");
	}
});

test("creates, removes, and re-creates worktree workspaces (no branch collision)", async ({ app }) => {
	await openFixtureProject(app);
	const items = worktreeRows(app);

	await createWorkspaceViaDialog(app);
	await expect(items).toHaveElements(1);
	const worktrees = gitText(E2E_FIXTURE_REPO, "worktree", "list");
	expect(worktrees.trim().split("\n").length).toBeGreaterThanOrEqual(2);
	expect(worktrees).toContain("/worktrees/sample-project/");

	await openWorkspaceMenu(items.first());
	await app.getByTestId("workspace-remove").click();
	await expect(app.getByTestId("confirm-dialog").filter({ hasText: /Remove .+ workspace/ })).toBeShown();
	await app.getByTestId("confirm-remove").click();
	await expect(items).toHaveElements(0);

	await expect(app.getByTestId("welcome")).toBeShown();
	await expect(app.getByTestId("center-tabs")).toHaveElements(0);
	await expect
		.poll(() => gitText(E2E_FIXTURE_REPO, "worktree", "list").trim().split("\n").length)
		.toBe(1);

	await createWorkspaceViaDialog(app);
	await expect(items).toHaveElements(1);
});
