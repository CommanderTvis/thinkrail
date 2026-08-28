import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test("a selection in the editor lands in the chat's composer, file and lines named", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await page.getByTestId("md-toggle-source").click();
	await expect(page.getByTestId("editor-pane")).toContainText("# sample-project");

	await page.getByTestId("editor-pane").getByText("# sample-project").last().click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Shift+End");

	await expect(async () => {
		await page.getByTestId("editor-pane").getByText("# sample-project").last().click({
			button: "right",
		});
		const item = page.locator(".monaco-menu .action-menu-item", {
			hasText: "Send selection to chat",
		});
		await expect(item).toBeVisible({ timeout: 2000 });
		await page.waitForTimeout(200);
		await item.click({ timeout: 1000 });
		await expect(page.getByTestId("chat-input")).toHaveValue(/README\.md:1/, { timeout: 2000 });
	}).toPass({ timeout: 20_000 });

	// The quote carries the code itself, not just a pointer to it, and the composer takes the caret so
	// the question can be typed straight away.
	await expect(page.getByTestId("chat-input")).toHaveValue(/# sample-project/);
	await expect(page.getByTestId("chat-input")).toBeFocused();
	await page.keyboard.type("what is this?");
	await expect(page.getByTestId("chat-input")).toHaveValue(/what is this\?$/);
});

test("the keyboard reaches the same action, and a second selection stacks under the first", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await page.getByTestId("md-toggle-source").click();
	await expect(page.getByTestId("editor-pane")).toContainText("# sample-project");

	await page.getByTestId("editor-pane").getByText("# sample-project").last().click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Shift+End");
	await page.keyboard.press("ControlOrMeta+Shift+L");
	await expect(page.getByTestId("chat-input")).toHaveValue(/README\.md:1/);

	await page.getByTestId("editor-tab").filter({ hasText: "README.md" }).click();
	await page.getByTestId("editor-pane").getByText("# sample-project").last().click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Shift+End");
	await page.keyboard.press("ControlOrMeta+Shift+L");
	const value = await page.getByTestId("chat-input").inputValue();
	expect(value.match(/README\.md:1/g)).toHaveLength(2);
});

test("a highlight in the editor shows in the composer as what the next message carries", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await page.getByTestId("md-toggle-source").click();
	await expect(page.getByTestId("editor-pane")).toContainText("# sample-project");

	// The file beside the chat, which is the shape this is for: highlight there, ask here.
	await page.getByTestId("editor-tab").filter({ hasText: "README.md" }).click({ button: "right" });
	await page.getByRole("menuitem", { name: "Split right", exact: true }).click();
	await expect(page.getByTestId("chat-input")).toBeVisible();

	// Nothing is attached until something is highlighted.
	await expect(page.getByTestId("composer-selection")).toHaveCount(0);
	await page.getByTestId("editor-pane").getByText("# sample-project").last().click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Shift+End");

	const chip = page.getByTestId("composer-selection");
	await expect(chip).toBeVisible();
	await expect(chip).toContainText("README.md:1");

	// Taking it off is the user's call, and a fresh highlight offers it again.
	await page.getByTestId("composer-selection-remove").click();
	await expect(chip).toHaveCount(0);
	await page.getByTestId("editor-pane").getByText("# sample-project").last().click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Shift+End");
	await expect(chip).toBeVisible();

	// Clicking into the editor without selecting anything drops it again.
	await page.getByTestId("editor-pane").getByText("# sample-project").last().click();
	await expect(chip).toHaveCount(0);

	// And what the chip promised is what the message carries.
	await page.getByTestId("editor-pane").getByText("# sample-project").last().click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Shift+End");
	await expect(chip).toBeVisible();
	await page.getByTestId("chat-input").fill("what is this?");
	await page.getByTestId("chat-input").press("Enter");
	const sent = page.locator('[data-testid="chat-message"][data-role="user"]').last();
	await expect(sent).toContainText("README.md:1");
	await expect(sent).toContainText("what is this?");
	await expect(chip).toHaveCount(0);
});
