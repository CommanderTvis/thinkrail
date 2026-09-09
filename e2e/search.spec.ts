import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

test("Mod+Shift+F searches the worktree and a hit opens its file at that line", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "haystack.txt"), "alpha\nbeta needle beta\ngamma\n");

	await page.keyboard.press("ControlOrMeta+Shift+KeyF");
	await expect(page.getByTestId("search-overlay")).toBeVisible();
	await page.getByTestId("search-query").fill("needle");

	const hit = page.getByTestId("search-hit");
	await expect(hit).toHaveCount(1);
	await expect(hit).toHaveAttribute("data-line", "2");
	await expect(page.getByTestId("search-file")).toHaveAttribute("data-path", "haystack.txt");

	await hit.click();
	await expect(page.getByTestId("search-overlay")).toHaveCount(0);
	await expect(page.getByTestId("editor-tab").filter({ hasText: "haystack.txt" })).toBeVisible();
	await expect(page.getByTestId("editor-pane")).toContainText("beta needle beta");
});

test("a hit in a markdown file flashes the block it landed in", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(
		join(worktree, "notes.md"),
		"# Notes\n\nA first paragraph.\n\nThe paragraph holding the quarkspindle.\n\nA last paragraph.\n",
	);

	await page.keyboard.press("ControlOrMeta+Shift+KeyF");
	await page.getByTestId("search-query").fill("quarkspindle");
	await page.getByTestId("search-hit").click();

	// Markdown opens rendered, so the line is answered by the block it fell in, not by a caret.
	const landed = page.locator(".source-landing");
	await expect(landed).toHaveCount(1);
	await expect(landed).toContainText("The paragraph holding the quarkspindle.");
});

test("a query with no matches says so, and Escape closes the popup", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	await page.keyboard.press("ControlOrMeta+Shift+KeyF");
	await page.getByTestId("search-query").fill("zzz-nothing-matches-this-zzz");
	await expect(page.getByTestId("search-empty")).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(page.getByTestId("search-overlay")).toHaveCount(0);
});
