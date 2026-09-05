import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
	openTerminal,
	visibleTerminal,
	visibleTerminalScreen,
	worktreeRows,
} from "./fixtures/app";

test("shows files and compacts single-directory runs in the Files tree", async ({ page }) => {
	await openFixtureProject(page);

	const workspace = await createWorkspaceViaDialog(page);
	mkdirSync(join(workspace.worktreePath, "compact", "only", "here"), { recursive: true });
	writeFileSync(join(workspace.worktreePath, "compact", "only", "here", "leaf.txt"), "leaf\n");
	await expect(worktreeRows(page).first()).toBeVisible();

	await page.getByTestId("tab-files").click();
	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();

	const folderRows = page.locator('[data-testid="file-node"][data-kind="dir"]');
	const compactFolder = folderRows.filter({ hasText: /^compact\/only\/here$/ });
	const leaf = page
		.locator('[data-testid="file-node"][data-kind="file"]')
		.filter({ hasText: /^leaf\.txt$/ });
	await expect(compactFolder).toBeVisible();
	await compactFolder.click();
	await expect(leaf).toBeVisible();

	mkdirSync(join(workspace.worktreePath, "compact", "only", "sibling"));
	await expect(folderRows.filter({ hasText: /^compact\/only$/ })).toBeVisible({ timeout: 10_000 });
	await expect(folderRows.filter({ hasText: /^here$/ })).toBeVisible();
	await expect(leaf).toBeVisible();
});

test("an entry git ignores is dimmed, whichever rule ignores it", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, ".gitignore"), "listed.log\n");
	const exclude = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
		cwd: workspace.worktreePath,
		encoding: "utf8",
	}).trim();
	mkdirSync(dirname(resolve(workspace.worktreePath, exclude)), { recursive: true });
	writeFileSync(resolve(workspace.worktreePath, exclude), "excluded.log\n");
	writeFileSync(join(workspace.worktreePath, "listed.log"), "");
	writeFileSync(join(workspace.worktreePath, "excluded.log"), "");
	writeFileSync(join(workspace.worktreePath, "kept.log"), "");

	await page.getByTestId("tab-files").click();
	const rows = page.locator('[data-testid="file-node"][data-kind="file"]');
	await expect(rows.filter({ hasText: /^listed\.log$/ })).toHaveAttribute("data-muted", "true");
	await expect(rows.filter({ hasText: /^excluded\.log$/ })).toHaveAttribute("data-muted", "true");
	await expect(rows.filter({ hasText: /^kept\.log$/ })).not.toHaveAttribute("data-muted", "true");
});

test("a file row drags into the composer as a mention and into a terminal as a path", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	const readme = page
		.locator('[data-testid="file-node"][data-kind="file"]')
		.filter({ hasText: /^README\.md$/ });
	await expect(readme).toBeVisible();

	await readme.dragTo(page.getByTestId("chat-input"));
	await expect(page.getByTestId("chat-input")).toHaveValue("@README.md ");

	await openTerminal(page);
	await readme.dragTo(visibleTerminal(page));
	await expect(visibleTerminalScreen(page)).toContainText(
		join(workspace.worktreePath, "README.md"),
	);
});

test("a file row has our own context menu, not the webview's", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tab-files").click();

	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });
	await expect(notes).toBeVisible();
	await notes.click({ button: "right" });

	const menu = page.getByTestId("file-node-actions");
	await expect(menu).toBeVisible();
	await expect(menu.getByTestId("file-node-reveal")).toBeVisible();
	await expect(menu.getByTestId("file-node-copy-path")).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(menu).toHaveCount(0);
});
