import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, waitTerminalReady } from "./fixtures/app";

test("folding a side group does not remount the centre", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await waitTerminalReady(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(page.getByTestId("editor-pane")).toBeVisible();

	// Hold the live centre node; a remount replaces it and the handle goes stale.
	const centre = await page.getByTestId("editor-pane").elementHandle();
	const terminal = await page.getByTestId("terminal-instance").first().elementHandle();

	const fold = page.getByTestId("side-group-fold").first();
	await fold.click();
	await expect(fold).toHaveAttribute("aria-label", "Expand group");

	const centreAlive = await centre?.evaluate((node) => node.isConnected);
	const terminalAlive = await terminal?.evaluate((node) => node.isConnected);
	expect({ centreAlive, terminalAlive }).toEqual({ centreAlive: true, terminalAlive: true });

	await fold.click();
	await expect(fold).toHaveAttribute("aria-label", "Fold group");
	expect(await centre?.evaluate((node) => node.isConnected)).toBe(true);
});
