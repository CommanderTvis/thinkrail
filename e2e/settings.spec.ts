import { expect, test } from "@playwright/test";

test("settings shows the Local GitHub status block and degrades gh gracefully", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();

	await page.getByTestId("settings-nav-github").click();
	await expect(dialog).toContainText("Local GitHub");

	const status = page.getByTestId("settings-gh-status");
	await expect(status).toHaveAttribute("data-connected", "false");
	await expect(status).toContainText("Not connected");
	await expect(page.getByTestId("settings-gh-refresh")).toBeVisible();

	await page.getByTestId("settings-gh-refresh").click();
	await expect(status).toHaveAttribute("data-connected", "false");

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("macOS opens settings with its own Preferences chord, and other platforms do not", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
	await page.keyboard.press("Meta+Comma");
	const dialog = page.getByTestId("settings-dialog");
	if (!mac) {
		// Nothing is bound off macOS: Ctrl+, and Cmd+, both belong to whatever else wants them.
		await expect(dialog).toHaveCount(0);
		await page.keyboard.press("Control+Comma");
		await expect(dialog).toHaveCount(0);
		return;
	}
	await expect(dialog).toBeVisible();

	// The section it was left on is the section it comes back to.
	await page.getByTestId("settings-nav-terminal").click();
	await expect(page.getByTestId("settings-terminal")).toBeVisible();
	await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
	await expect(dialog).toHaveCount(0);
	await page.keyboard.press("Meta+Comma");
	await expect(page.getByTestId("settings-terminal")).toBeVisible();
});
