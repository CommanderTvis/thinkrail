import { writeFileSync } from "node:fs";
import { join } from "node:path";
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

test("a change row wears the icon too, in both of the panel's views", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "server.py"), "print('hi')\n");

	await page.getByTestId("tab-changes").click();
	const row = page.getByTestId("change-item").filter({ hasText: "server.py" });
	await expect(row).toBeVisible({ timeout: 10_000 });
	await expect(row.getByTestId("file-type-icon")).toHaveAttribute("data-icon", "python");

	await page.getByTestId("changes-toggle-tree").click();
	await expect(
		page.getByTestId("change-node").filter({ hasText: "server.py" }).getByTestId("file-type-icon"),
	).toHaveAttribute("data-icon", "python");
});
