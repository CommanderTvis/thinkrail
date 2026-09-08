import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openAppFresh, stageProjectParent } from "./fixtures/app";
import { git } from "./fixtures/git";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";

const PARENT = join(E2E_DATA_DIR, "clone-project-parent");

function bareRemote(name: string): string {
	const remote = join(E2E_DATA_DIR, `${name}.git`);
	rmSync(remote, { recursive: true, force: true });
	mkdirSync(remote, { recursive: true });
	git(remote, "init", "--bare", "-b", "main");
	git(E2E_FIXTURE_REPO, "push", remote, "main");
	return remote;
}

async function openCloneDialog(page: import("@playwright/test").Page, url: string) {
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-clone-project").click();
	await page.getByTestId("clone-project-url").fill(url);
	await page.getByTestId("clone-project-parent").click();
	await expect(page.getByTestId("clone-project-parent")).toContainText(PARENT);
}

test.describe("clone repository", () => {
	test("clones into the chosen folder, names it after the repository, and opens it", async ({
		page,
	}) => {
		await openAppFresh(page);
		stageProjectParent(PARENT);
		const remote = bareRemote("clone-source");

		await openCloneDialog(page, `file://${remote}`);
		await expect(page.getByTestId("clone-project-name")).toHaveValue("");
		await expect(page.getByTestId("clone-project-name")).toHaveAttribute(
			"placeholder",
			"clone-source",
		);
		await expect(page.getByTestId("clone-project-target")).toContainText(
			join(PARENT, "clone-source"),
		);
		await page.getByTestId("clone-project-depth").fill("0");
		await expect(page.getByTestId("clone-project-create")).toBeDisabled();
		await page.getByTestId("clone-project-depth").fill("1");
		await page.getByTestId("clone-project-create").click();

		await expect(page.getByTestId("clone-project-dialog")).toBeHidden();
		await expect(
			page.locator('[data-testid="project-name"]', { hasText: "clone-source" }),
		).toBeVisible();
		expect(existsSync(join(PARENT, "clone-source", ".git"))).toBe(true);
		expect(existsSync(join(PARENT, "clone-source", ".git", "shallow"))).toBe(true);
	});

	test("a clone that fails reports git's reason and leaves nothing behind", async ({ page }) => {
		await openAppFresh(page);
		stageProjectParent(PARENT);

		await openCloneDialog(page, join(E2E_DATA_DIR, "no-such-remote.git"));
		await page.getByTestId("clone-project-create").click();

		await expect(page.getByTestId("clone-project-error")).toContainText("does not exist");
		await expect(page.getByTestId("clone-project-dialog")).toBeVisible();
		expect(readdirSync(PARENT)).toEqual([]);
	});
});
