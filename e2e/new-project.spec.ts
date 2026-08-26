import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openAppFresh, stageProjectParent } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

const PARENT = join(E2E_DATA_DIR, "new-project-parent");

async function createProject(page: import("@playwright/test").Page, name: string): Promise<string> {
	await page.getByRole("button", { name: "New project" }).click();
	await page.getByTestId("new-project-parent").click();
	await expect(page.getByTestId("new-project-parent")).toContainText(PARENT);
	await page.getByTestId("new-project-name").fill(name);
	await page.getByTestId("new-project-create").click();
	await expect(page.getByTestId("new-project-dialog")).toContainText(`${name} is ready`);
	return join(PARENT, name);
}

test.describe("new project", () => {
	test("creates a folder with a committed repo in it, opens it, and offers a blueprint", async ({
		page,
	}) => {
		await openAppFresh(page);
		stageProjectParent(PARENT);

		await expect(page.getByTestId("new-project-create")).toHaveCount(0);
		const created = await createProject(page, "Lightbulb App");

		expect(existsSync(join(created, ".git"))).toBe(true);
		// The root commit is what every git-backed surface needs to resolve a revision at all.
		expect(spawnSync("git", ["-C", created, "rev-parse", "--verify", "HEAD"]).status).toBe(0);
		expect(spawnSync("git", ["-C", created, "ls-files"]).stdout.toString().trim()).toBe("");

		await expect(
			page.locator('[data-testid="project-name"]', { hasText: "Lightbulb App" }),
		).toBeVisible();

		await page.getByTestId("new-project-blueprint").click();
		await expect(page.getByTestId("new-project-dialog")).toBeHidden();
		await expect(page.getByTestId("blueprint-start")).toBeVisible();
	});

	test("a name that would escape the chosen folder is refused, and nothing is created", async ({
		page,
	}) => {
		await openAppFresh(page);
		stageProjectParent(PARENT);

		await page.getByRole("button", { name: "New project" }).click();
		await page.getByTestId("new-project-parent").click();
		await page.getByTestId("new-project-name").fill("../escaped");
		await page.getByTestId("new-project-create").click();

		await expect(page.getByTestId("new-project-error")).toContainText("Not a usable folder name");
		expect(readdirSync(PARENT)).toEqual([]);
	});

	test("a fresh project can cut a workspace immediately, with no commit of the user's own", async ({
		page,
	}) => {
		await openAppFresh(page);
		stageProjectParent(PARENT);

		await createProject(page, "buildable");
		await page.getByTestId("new-project-done").click();

		await page.getByRole("button", { name: "Start building" }).click();
		await page.getByTestId("create-workspace").click();

		await expect(page.getByTestId("new-workspace-dialog")).toBeHidden();
		await expect(
			page.locator('[data-testid="editor-tab"][data-kind="chat"]').first(),
		).toBeVisible();
	});
});
