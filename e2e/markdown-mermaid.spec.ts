import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test("renders mermaid fences as diagrams in the rendered markdown view", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	const file = page.getByTestId("file-node").filter({ hasText: "DIAGRAM.md" });
	await expect(file).toBeVisible();
	await file.dblclick();

	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();

	await expect(preview.getByTestId("mermaid-svg").locator("svg")).toBeVisible({ timeout: 20_000 });
	await expect(preview.getByTestId("mermaid-svg")).toHaveCount(1);
	const error = preview.getByTestId("mermaid-error");
	await expect(error).toHaveCount(1);
	await expect(error).toContainText("broken");

	await expect(preview.locator("pre.shiki", { hasText: "plain-fence-stays-code" })).toBeVisible();

	const diagram = preview.getByTestId("mermaid-svg");
	const capped = await diagram.boundingBox();
	const drawn = await diagram.locator("svg").boundingBox();
	expect(capped?.height ?? 0).toBeLessThanOrEqual(480);
	expect(drawn?.height ?? 0).toBeGreaterThan(capped?.height ?? 0);

	for (let i = 0; i < 6; i++) await preview.getByTestId("mermaid-zoom-in").click();
	await expect(preview.getByTestId("mermaid-zoom-level")).not.toHaveText("100%");
	expect((await diagram.boundingBox())?.height ?? 0).toBeLessThanOrEqual(480);
	// Zooming enlarges the drawing itself; the box keeps its height and the overflow is pannable.
	const enlarged = await diagram.locator("svg").boundingBox();
	expect(enlarged?.width ?? 0).toBeGreaterThan((drawn?.width ?? 0) * 1.5);
	const pannable = await diagram.evaluate((node) => ({
		overflowing: node.scrollWidth > node.clientWidth,
		clipped: getComputedStyle(node).overflowX === "hidden",
	}));
	expect(pannable).toEqual({ overflowing: true, clipped: true });
	await preview.getByTestId("mermaid-zoom-reset").click();
	await expect(preview.getByTestId("mermaid-zoom-level")).toHaveText("100%");

	await preview.getByTestId("mermaid-fullscreen").click();
	const dialog = page.getByTestId("mermaid-fullscreen-dialog");
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);

	await page.getByTestId("md-toggle-source").click();
	await expect(page.getByTestId("editor-pane")).toContainText("flowchart TD; Start --> Finish");
});
