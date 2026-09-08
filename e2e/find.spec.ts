import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";

async function openReadme(page: import("@playwright/test").Page) {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).click();
	await expect(page.getByTestId("markdown-preview")).toContainText("sample-project");
}

const highlighted = (page: import("@playwright/test").Page, name: string) =>
	page.evaluate((key) => CSS.highlights.get(key)?.size ?? 0, name);

test("Mod+F over a preview opens the find bar and highlights the matches", async ({ page }) => {
	await openReadme(page);

	await page.getByTestId("markdown-preview").click();
	await page.keyboard.press("ControlOrMeta+f");
	const input = page.getByTestId("find-input");
	await expect(input).toBeFocused();

	await input.fill("sample-project");
	await expect(input).toHaveAttribute("data-missed", "false");
	await expect(page.getByTestId("find-count")).toHaveText(/^1\/[1-9]\d*$/);
	expect(await highlighted(page, "thinkrail-find")).toBeGreaterThan(0);
	expect(await highlighted(page, "thinkrail-find-current")).toBe(1);

	await page.keyboard.press("Enter");
	await expect(page.getByTestId("find-count")).toHaveText(/^[12]\/[1-9]\d*$/);

	await input.fill("no-such-text-anywhere");
	await expect(input).toHaveAttribute("data-missed", "true");
	await expect(page.getByTestId("find-count")).toHaveText("0/0");

	await page.keyboard.press("Escape");
	await expect(page.getByTestId("find-bar")).toHaveCount(0);
	expect(await highlighted(page, "thinkrail-find")).toBe(0);
});

test("Mod+F inside the editor is left to Monaco's own find widget", async ({ page }) => {
	await openReadme(page);

	await page.getByTestId("md-toggle-source").click();
	const editor = page.locator(".monaco-editor").first();
	await editor.locator(".view-lines").click();
	// Headless Chromium here carries a Windows user agent, so Monaco binds Ctrl+F while the shell
	// (which reads navigator.platform) binds Meta+F; both chords must leave the shell's bar closed.
	await page.keyboard.press("ControlOrMeta+f");
	await page.keyboard.press("Control+f");

	await expect(editor.locator(".find-widget.visible")).toBeVisible();
	await expect(page.getByTestId("find-bar")).toHaveCount(0);
});
