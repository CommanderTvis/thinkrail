import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";

async function openDiscordSettings(page: import("@playwright/test").Page): Promise<void> {
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await page.getByTestId("settings-nav-discord").click();
	await expect(page.getByTestId("settings-discord")).toBeVisible();
}

// The host remembers these, and a test's state outlives the run that set it — the first test here
// asserts what a fresh install looks like, so the lane is handed back that way.
test.afterEach(async ({ page }) => {
	await page.goto("/");
	await openDiscordSettings(page);
	const input = page.getByTestId("discord-application-id");
	await input.fill("");
	await input.blur();
	const toggle = page.getByTestId("discord-toggle");
	if ((await toggle.getAttribute("data-active")) === "true") await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "false");
});

test("Discord Rich Presence starts off, wearing ThinkRail's own application", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await openDiscordSettings(page);

	await expect(page.getByTestId("discord-toggle")).toHaveAttribute("data-active", "false");
	await expect(page.getByTestId("discord-status")).toContainText("Off");
	// Enabling it is the only step: the presence has a name to wear out of the box.
	await expect(page.getByTestId("discord-application-id")).toHaveValue(/^\d{15,25}$/);

	// Clearing the field is a choice, and the one that puts it back in the silent state.
	await page.getByTestId("discord-application-id").fill("");
	await page.getByTestId("discord-application-id").blur();
	await page.getByTestId("discord-toggle").click();
	await expect(page.getByTestId("discord-toggle")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("discord-status")).toContainText("application id");
});

test("an invalid application id is rejected, and a valid one is kept after reload", async ({
	page,
}) => {
	await page.goto("/");
	await openDiscordSettings(page);

	const input = page.getByTestId("discord-application-id");
	await input.fill("not-a-snowflake");
	await input.blur();
	await expect(input).toHaveValue("not-a-snowflake");
	await page.reload();
	await openDiscordSettings(page);
	await expect(page.getByTestId("discord-application-id")).toHaveValue("");

	await input.fill("1234567890123456789");
	await input.blur();
	await page.reload();
	await openDiscordSettings(page);
	await expect(page.getByTestId("discord-application-id")).toHaveValue("1234567890123456789");
});

test("a blocked project stays blocked across a reload", async ({ page }) => {
	await openFixtureProject(page);
	await openDiscordSettings(page);
	await page.getByTestId("discord-toggle").click();
	await page.getByTestId("discord-application-id").fill("1234567890123456789");
	await page.getByTestId("discord-application-id").blur();

	const block = page.locator('[data-testid^="discord-block-"]').first();
	const testId = await block.getAttribute("data-testid");
	if (!testId) throw new Error("no project listed to block");

	await expect(block).toHaveAttribute("aria-pressed", "false");
	await block.click();
	await expect(block).toHaveAttribute("aria-pressed", "true");

	await page.reload();
	await openDiscordSettings(page);
	await expect(page.getByTestId(testId)).toHaveAttribute("aria-pressed", "true");
});
