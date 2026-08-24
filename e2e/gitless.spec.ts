import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openAppFresh,
	openFixtureProject,
	stagePlainFolder,
} from "./fixtures/app";
import { E2E_DATA_DIR, E2E_PICK_DIR_POINTER } from "./fixtures/paths";

/** A repository with no commits — git is there, but has nothing to compare against yet. */
function stageUnbornRepo(): string {
	const dir = join(E2E_DATA_DIR, "unborn-repo");
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "notes.txt"), "not committed\n");
	execFileSync("git", ["-C", dir, "init", "-b", "main"], { stdio: "ignore" });
	writeFileSync(E2E_PICK_DIR_POINTER, dir);
	return dir;
}

/** Staging happens after the reset: `resetState` re-points the host's picker at the fixture repo. */
async function openFolderAndWork(page: Page, stage: () => string): Promise<void> {
	await openAppFresh(page);
	const dir = stage();
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("project-item").filter({ hasText: basename(dir) })).toBeVisible();
	await page.getByTestId("welcome-action").filter({ hasText: "Work in project folder" }).click();
	await expect(page.getByTestId("center-tabs")).toBeVisible();
}

/** Tools already docked, which is why "offered" alone cannot answer whether one is available. */
async function placedTools(page: Page): Promise<string[]> {
	const tabs = page.locator('[data-testid^="tab-"]');
	const found: string[] = [];
	for (let index = 0; index < (await tabs.count()); index += 1) {
		const id = await tabs.nth(index).getAttribute("data-testid");
		if (id) found.push(id.replace("tab-", ""));
	}
	return found;
}

/** Every tool the side menus offer to reveal, across every side group. */
async function offeredTools(page: Page): Promise<string[]> {
	const found = new Set<string>();
	const menus = page.getByTestId("side-group-menu");
	for (let index = 0; index < (await menus.count()); index += 1) {
		await menus.nth(index).click();
		const items = page.locator('[data-testid^="show-tool-"]');
		for (let item = 0; item < (await items.count()); item += 1) {
			const id = await items.nth(item).getAttribute("data-testid");
			if (id) found.add(id.replace("show-tool-", ""));
		}
		await page.keyboard.press("Escape");
	}
	return [...found];
}

async function expectGitToolsWithheld(page: Page, vcs: "none" | "unborn"): Promise<void> {
	// A tab a layout preset already placed says why, rather than showing a red git error.
	for (const tool of ["changes", "review"] as const) {
		const tab = page.getByTestId(`tab-${tool}`);
		if ((await tab.count()) === 0) continue;
		await tab.first().click();
		const notice = page.getByTestId("tool-needs-git");
		await expect(notice).toBeVisible();
		await expect(notice).toHaveAttribute("data-vcs", vcs);
		// A tool tab closes from its context menu; only editors and terminals carry a close cross.
		await tab.first().click({ button: "right" });
		await page.getByRole("menuitem", { name: "Close", exact: true }).click();
		await expect(tab).toHaveCount(0);
	}

	// And once closed, nothing can open them again: the reveal menus do not list them.
	const offered = await offeredTools(page);
	expect(offered).not.toContain("changes");
	expect(offered).not.toContain("review");
	// A tool that *is* missing proves the menus were read rather than found empty.
	expect(offered).toContain("claude");
}

test("a folder that is not a repository offers neither Changes nor Review", async ({ page }) => {
	await openFolderAndWork(page, stagePlainFolder);
	await expectGitToolsWithheld(page, "none");
});

test("a repository with no commits withholds them too, until the first commit", async ({
	page,
}) => {
	await openFolderAndWork(page, stageUnbornRepo);
	await expectGitToolsWithheld(page, "unborn");
});

test("a real repository still offers both — the withholding is about git, not about the panes", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const offered = await offeredTools(page);
	expect([...offered, ...(await placedTools(page))]).toEqual(
		expect.arrayContaining(["changes", "review"]),
	);
});
