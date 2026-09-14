import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, setPluginEnabled } from "../../fixtures/app";

// spec-dialect ships enabledByDefault; other specs assume it stays on, so this hands the lane back.
test.afterEach(async ({ page }) => {
	await setPluginEnabled(page, "spec-dialect", true);
});

test("disabling spec-dialect turns its tab into the dormant placeholder, re-enabling brings it back", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	const tab = page.getByTestId("tab-plugin:spec-dialect:specs");
	await expect(tab).toBeVisible();
	await tab.click();
	await expect(page.locator('[data-testid="spec-node"]').first()).toBeVisible();

	await setPluginEnabled(page, "spec-dialect", false);
	await expect(tab).toBeVisible();
	await tab.click();
	await expect(page.getByTestId("plugin-tool-dormant")).toContainText("is off");

	await setPluginEnabled(page, "spec-dialect", true);
	await tab.click();
	await expect(page.locator('[data-testid="spec-node"]').first()).toBeVisible();
});
