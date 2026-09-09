import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { gitQuiet as git } from "./fixtures/git";
import { E2E_DATA_DIR, E2E_PICK_DIR_POINTER } from "./fixtures/paths";

function seedSecondRepo(): void {
	const repo = join(E2E_DATA_DIR, "second-project");
	rmSync(repo, { recursive: true, force: true });
	mkdirSync(repo, { recursive: true });
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "e2e@thinkrail.test");
	git(repo, "config", "user.name", "ThinkRail E2E");
	git(repo, "config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "README.md"), "# second project\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "seed");
	writeFileSync(E2E_PICK_DIR_POINTER, repo);
}

async function enterProjectFolder(page: Page): Promise<void> {
	await page.getByTestId("welcome-action").filter({ hasText: "Work in project folder" }).click();
	await expect(page.getByTestId("center-tabs")).toBeVisible();
}

async function splitCenter(page: Page): Promise<void> {
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	const readme = page.getByTestId("editor-tab").filter({ hasText: "README.md" });
	await expect(readme).toBeVisible();
	await readme.click({ button: "right" });
	await page.getByRole("menuitem", { name: "Split right" }).click();
	await expect(page.getByTestId("center-group")).toHaveCount(2);
}

test("a center split belongs to the project it was made in", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await splitCenter(page);

	seedSecondRepo();
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("welcome-title")).toHaveText("second-project", { timeout: 10_000 });
	await enterProjectFolder(page);
	await expect(page.getByTestId("center-group")).toHaveCount(1);

	await page.getByTestId("project-item").filter({ hasText: "sample-project" }).click();
	await enterProjectFolder(page);
	await expect(page.getByTestId("center-group")).toHaveCount(2);
});

test("open tabs survive a round trip between projects", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	const readme = page.getByTestId("editor-tab").filter({ hasText: "README.md" });
	await expect(readme).toBeVisible();

	seedSecondRepo();
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("welcome-title")).toHaveText("second-project", { timeout: 10_000 });
	await enterProjectFolder(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toBeVisible();

	await page.getByTestId("project-item").filter({ hasText: "sample-project" }).click();
	await enterProjectFolder(page);
	await expect(readme).toBeVisible();

	await page.getByTestId("project-item").filter({ hasText: "second-project" }).click();
	await enterProjectFolder(page);
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toBeVisible();
});

test("a project's frame survives a reload without the other project's split", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await splitCenter(page);

	seedSecondRepo();
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("welcome-title")).toHaveText("second-project", { timeout: 10_000 });
	await enterProjectFolder(page);
	await expect(page.getByTestId("center-group")).toHaveCount(1);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("center-group")).toHaveCount(1);

	await page.getByTestId("project-item").filter({ hasText: "sample-project" }).click();
	await enterProjectFolder(page);
	await expect(page.getByTestId("center-group")).toHaveCount(2);

	await page.getByTestId("project-item").filter({ hasText: "second-project" }).click();
	await enterProjectFolder(page);
	await expect(page.getByTestId("center-group")).toHaveCount(1);
});
