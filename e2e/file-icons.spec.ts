import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test("a file row wears its own type's icon, drawn in the theme's colour", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	const iconFor = (name: string) =>
		page.getByTestId("file-node").filter({ hasText: name }).getByTestId("file-type-icon");
	// README has an icon of its own, which is the point of consulting whole filenames first.
	await expect(iconFor("README.md")).toHaveAttribute("data-icon", "readme");
	await expect(iconFor("SPEC.md")).toHaveAttribute("data-icon", "markdown");
	await expect(iconFor("logo.png")).toHaveAttribute("data-icon", "image");
	await expect(iconFor("sample.pdf")).toHaveAttribute("data-icon", "pdf");

	// The SVG is fetched and inlined, recoloured to whatever the row inherits.
	const svg = iconFor("README.md").locator("svg");
	await expect(svg).toBeVisible();
	expect(await svg.locator("[fill]").first().getAttribute("fill")).toBe("currentColor");

	// And an editor tab says the same thing about the file it holds.
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(
		page.getByTestId("editor-tab").filter({ hasText: "README.md" }).getByTestId("file-type-icon"),
	).toHaveAttribute("data-icon", "readme");
});
