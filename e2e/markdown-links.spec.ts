import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

test("a parent-relative file link cannot escape into browser navigation", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "styles" }).click();
	await page.getByTestId("file-node").filter({ hasText: "COLOR.md" }).dblclick();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();

	await page.getByTestId("file-node").filter({ hasText: "LINKS.md" }).click();
	const priorPreview = page.getByTestId("editor-tab").filter({ hasText: "LINKS.md" });
	await expect(priorPreview).toHaveAttribute("data-preview", "true");
	await page.getByTestId("editor-tab").filter({ hasText: "COLOR.md" }).click();
	await expect(preview.getByRole("heading", { name: "Colour system" })).toBeVisible();

	const link = preview.getByTestId("markdown-file-link");
	await expect(link).toHaveAttribute("data-path", "themes/SPEC.md");
	await expect(link).not.toHaveAttribute("href", /.+/);
	const urlBefore = page.url();
	const pagesBefore = page.context().pages().length;

	await link.click();

	await expect(preview.getByRole("heading", { name: "Theme spec target" })).toBeVisible();
	const targetTab = page.getByTestId("editor-tab").filter({ hasText: "SPEC.md" });
	await expect(targetTab).toHaveAttribute("data-preview", "true");
	await expect(priorPreview).toHaveCount(0);
	expect(page.url()).toBe(urlBefore);
	expect(page.context().pages()).toHaveLength(pagesBefore);
});

test("relative links, images, and heading anchors work in the rendered markdown view", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "LINKS.md" }).dblclick();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();

	await expect(preview.locator("#section-two")).toHaveCount(1);

	const img = preview.locator("img");
	await expect(img).toHaveAttribute("src", /\/files\/[^/]+\/logo\.png$/);
	await expect
		.poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
		.toBeGreaterThan(0);

	await preview.getByRole("link", { name: "Section two" }).click();
	await expect(page.getByTestId("editor-tab")).toHaveCount(2);
	await expect(preview).toBeVisible();

	await preview.getByTestId("markdown-file-link").click();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "SPEC.md" })).toBeVisible();
});

test("a document opened again comes back highlighted, without re-tokenizing it", async ({
	page,
}) => {
	writeFileSync(
		join(E2E_FIXTURE_REPO, "highlighted.md"),
		"# Code\n\n```ts\nexport const marker = 1;\n```\n",
	);
	writeFileSync(join(E2E_FIXTURE_REPO, "plain.md"), "# Plain\n\nNothing to highlight here.\n");
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tab-files").click();
	for (const name of ["highlighted.md", "plain.md"]) {
		const row = page.getByTestId("file-node").filter({ hasText: name });
		await expect(row).toBeVisible();
		await row.dblclick();
	}

	const highlighted = page.locator(".shiki").first();
	const back = page.getByTestId("editor-tab").filter({ hasText: "highlighted.md" });
	await back.click();
	await expect(highlighted).toBeVisible();

	// Second visit: the block is highlighted in the first frame rather than starting as a plain <pre>.
	await page.getByTestId("editor-tab").filter({ hasText: "plain.md" }).click();
	await expect(page.locator(".shiki")).toHaveCount(0);
	await back.click();
	expect(await page.evaluate(() => document.querySelectorAll(".shiki").length)).toBeGreaterThan(0);
});
