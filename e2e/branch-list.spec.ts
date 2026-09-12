import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { gitQuiet as git } from "./fixtures/git";
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
