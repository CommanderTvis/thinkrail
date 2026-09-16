import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { gitQuiet as git, gitText } from "./fixtures/git";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";

test("the branch chip lists branches with their worktrees, and guards deletion", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	git(E2E_FIXTURE_REPO, "branch", "spare-branch");

	await page.getByTestId("scope-branch").click();
	const list = page.getByTestId("branch-list");
	await expect(list).toBeVisible();

	// The workspace's own branch shows where it is checked out, and refuses deletion.
	const mine = list.getByTestId("branch-row").filter({ hasText: workspace.branch });
	await expect(mine.getByTestId("branch-worktree")).toContainText("worktrees");
	await expect(mine.getByTestId("branch-delete")).toBeDisabled();

	// A branch nothing has checked out has no path, and deleting it asks first.
	const spare = list.getByTestId("branch-row").filter({ hasText: "spare-branch" });
	await expect(spare.getByTestId("branch-worktree")).toHaveCount(0);
	await spare.getByTestId("branch-delete").click();
	await expect(page.getByTestId("branch-delete-confirm")).toBeVisible();
	await page.getByTestId("branch-delete-confirm").click();
	await expect(list.getByTestId("branch-row").filter({ hasText: "spare-branch" })).toHaveCount(0);
	await expect(mine).toHaveCount(1);
});

test("left-clicking a branch checked out by a ThinkRail workspace switches to it", async ({
	page,
}) => {
	await openFixtureProject(page);
	const first = await createWorkspaceViaDialog(page);
	await createWorkspaceViaDialog(page);

	await page.getByTestId("scope-branch").click();
	const list = page.getByTestId("branch-list");
	const firstRow = list.getByTestId("branch-row").filter({ hasText: first.branch });
	await firstRow.getByTestId("branch-open-workspace").click();

	await expect(list).toBeHidden();
	await expect(page.getByTestId("scope-name")).toHaveText(first.name);
});

test("the branch list groups branches from every configured remote, and a remote-only branch opens New Workspace prefilled", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	git(E2E_FIXTURE_REPO, "remote", "add", "list-origin", "https://example.invalid/origin.git");
	git(E2E_FIXTURE_REPO, "remote", "add", "list-upstream", "https://example.invalid/upstream.git");
	git(E2E_FIXTURE_REPO, "update-ref", "refs/remotes/list-origin/remote-only-branch", "HEAD");
	git(E2E_FIXTURE_REPO, "update-ref", "refs/remotes/list-upstream/other-remote-branch", "HEAD");

	await page.getByTestId("scope-branch").click();
	const list = page.getByTestId("branch-list");
	await expect(
		list.getByTestId("remote-group-toggle").filter({ hasText: "list-origin" }),
	).toBeVisible();
	await expect(
		list.getByTestId("remote-group-toggle").filter({ hasText: "list-upstream" }),
	).toBeVisible();
	const remoteRow = list.getByTestId("branch-remote-row").filter({ hasText: "remote-only-branch" });
	await expect(remoteRow).toBeVisible();

	await remoteRow.getByTestId("branch-remote-open").click();
	await expect(list).toBeHidden();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await expect(page.getByTestId("ws-branch-picker")).toContainText(
		"list-origin/remote-only-branch",
	);
});

test("a remote group can be collapsed and expanded, and stays that way in every branch picker", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	git(E2E_FIXTURE_REPO, "remote", "add", "collapse-origin", "https://example.invalid/origin.git");
	git(E2E_FIXTURE_REPO, "update-ref", "refs/remotes/collapse-origin/collapsible-branch", "HEAD");

	await page.getByTestId("scope-branch").click();
	const list = page.getByTestId("branch-list");
	const toggle = list.getByTestId("remote-group-toggle").filter({ hasText: "collapse-origin" });
	const row = list.getByTestId("branch-remote-row").filter({ hasText: "collapsible-branch" });
	await expect(row).toBeVisible();
	await toggle.click();
	await expect(row).toBeHidden();

	// Closing and reopening the popover keeps the remote collapsed.
	await page.keyboard.press("Escape");
	await expect(list).toBeHidden();
	await page.getByTestId("scope-branch").click();
	await expect(
		list.getByTestId("branch-remote-row").filter({ hasText: "collapsible-branch" }),
	).toBeHidden();

	// The same collapse preference applies in the New Workspace dialog's branch picker.
	await page.keyboard.press("Escape");
	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("ws-branch-picker").click();
	await expect(
		page.getByTestId("branch-option").filter({ hasText: "collapsible-branch" }),
	).toBeHidden();
	await expect(
		page.getByTestId("remote-group-toggle").filter({ hasText: "collapse-origin" }),
	).toBeVisible();
});

test("a branch held by a worktree ThinkRail did not make is still the user's to delete", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	// The shape a migrator arrives in: worktrees made by another tool, under its own directory.
	const foreign = join(E2E_DATA_DIR, "foreign-worktrees", "agent-1");
	rmSync(join(E2E_DATA_DIR, "foreign-worktrees"), { recursive: true, force: true });
	git(E2E_FIXTURE_REPO, "worktree", "add", "-b", "foreign-branch", foreign);

	await page.getByTestId("scope-branch").click();
	const row = page
		.getByTestId("branch-list")
		.getByTestId("branch-row")
		.filter({ hasText: "foreign-branch" });
	await expect(row.getByTestId("branch-worktree")).toContainText("agent-1");
	// No ThinkRail workspace lives there, so nothing refuses — the confirm names what goes with it.
	await expect(row.getByTestId("branch-delete")).toBeEnabled();
	await row.getByTestId("branch-delete").click();
	await expect(page.getByTestId("branch-delete-confirm")).toBeVisible();
	await page.getByTestId("branch-delete-confirm").click();

	await expect(
		page.getByTestId("branch-list").getByTestId("branch-row").filter({ hasText: "foreign-branch" }),
	).toHaveCount(0);
	expect(existsSync(foreign)).toBe(false);
});

test("a dirty external worktree requires a second force-delete confirmation", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const foreign = join(E2E_DATA_DIR, "foreign-worktrees", "dirty-agent");
	rmSync(join(E2E_DATA_DIR, "foreign-worktrees"), { recursive: true, force: true });
	git(E2E_FIXTURE_REPO, "worktree", "add", "-b", "dirty-foreign-branch", foreign);
	const untracked = join(foreign, "untracked.txt");
	writeFileSync(untracked, "this work must not disappear without force\n");

	await page.getByTestId("scope-branch").click();
	const row = page
		.getByTestId("branch-list")
		.getByTestId("branch-row")
		.filter({ hasText: "dirty-foreign-branch" });
	await row.getByTestId("branch-delete").click();
	await page.getByTestId("branch-delete-confirm").click();
	const recovery = page.getByTestId("confirm-dialog");
	await expect(recovery).toContainText("contains modified or untracked files");
	await recovery.getByTestId("branch-force-recovery").click();
	const force = page.getByTestId("confirm-dialog");
	await expect(force).toContainText(foreign);
	await expect(force).toContainText("uncommitted and untracked files will be discarded");
	await force.getByRole("button", { name: "Cancel" }).click();
	await expect.poll(() => existsSync(untracked)).toBe(true);

	await row.getByTestId("branch-delete").click();
	await page.getByTestId("branch-delete-confirm").click();
	await page.getByTestId("branch-force-recovery").click();
	await page.getByTestId("branch-force-confirm").click();
	await expect(row).toHaveCount(0);
	expect(existsSync(foreign)).toBe(false);
});

test("Fetch brings the remotes up to date from the branch list", async ({ page }) => {
	// A real remote for the fixture to fetch from, with a commit it has not seen.
	const origin = join(E2E_DATA_DIR, "branch-list-origin.git");
	const writer = join(E2E_DATA_DIR, "branch-list-writer");
	rmSync(origin, { recursive: true, force: true });
	rmSync(writer, { recursive: true, force: true });
	mkdirSync(origin, { recursive: true });
	git(origin, "init", "--bare", "-q", "-b", "main");

	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	git(E2E_FIXTURE_REPO, "remote", "add", "fetch-origin", origin);
	git(E2E_FIXTURE_REPO, "push", "-q", "fetch-origin", "main");
	git(E2E_DATA_DIR, "clone", "-q", origin, writer);
	git(writer, "commit", "--allow-empty", "-q", "-m", "written on the remote");
	git(writer, "push", "-q", "origin", "main");

	const seen = () => gitText(E2E_FIXTURE_REPO, "rev-parse", "fetch-origin/main").trim();
	const before = seen();

	await page.getByTestId("scope-branch").click();
	await page.getByTestId("branch-fetch").click();
	await expect.poll(seen, { timeout: 30_000 }).not.toBe(before);
	// The list is still there afterwards, re-read rather than left as it was.
	await expect(page.getByTestId("branch-list")).toBeVisible();
});

test("the topbar branch list marks its Local branches, mirroring the Changes picker", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	await page.getByTestId("scope-branch").click();
	const list = page.getByTestId("branch-list");
	await expect(list.getByText("Local", { exact: true })).toBeVisible();
});
