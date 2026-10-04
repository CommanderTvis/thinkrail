import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { asciiPdf, lfsPointer } from "./fixtures/repo";

test("opens a file in a center Monaco tab, focuses on re-open, and closes", async ({ page }) => {
	await openFixtureProject(page);

	await createWorkspaceViaDialog(page);
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTab.hover();
	await chatTab.getByTestId("editor-tab-close").click();
	await expect(chatTab).toHaveCount(0);
	await page.getByTestId("tab-files").click();
	const readme = page.getByTestId("file-node").filter({ hasText: "README.md" });
	await expect(readme).toBeVisible();

	await readme.dblclick();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toBeVisible();
	await expect(page.getByTestId("markdown-preview")).toContainText("sample-project");
	await expect(page.getByTestId("view-toggle-markdown")).toHaveAttribute("data-active", "true");

	await page.getByTestId("view-toggle-code").click();
	await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
	await expect(page.getByTestId("editor-pane")).toContainText("# sample-project");
	await page.getByTestId("view-toggle-markdown").click();
	await expect(page.getByTestId("markdown-preview")).toContainText("sample-project");

	await readme.dblclick();
	await expect(page.getByTestId("editor-tab")).toHaveCount(1);

	const tab = page.getByTestId("editor-tab");
	await tab.hover();
	await tab.getByTestId("editor-tab-close").click();
	await expect(page.getByTestId("editor-tab")).toHaveCount(0);
	await expect(page.getByTestId("workspace-ready")).toContainText("Workspace ready");
	await expect(page.getByTestId("workspace-ready")).toContainText(
		"Files, chats, changes, and terminals are scoped to this workspace",
	);
});

test("hides YAML frontmatter in the rendered view but shows it in source", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	const spec = page.getByTestId("file-node").filter({ hasText: "SPEC.md" });
	await expect(spec).toBeVisible();
	await spec.dblclick();

	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toContainText("Goal");
	await expect(preview).not.toContainText("goal-and-requirements");
	await expect(preview).not.toContainText("id: sample-root");

	await page.getByTestId("view-toggle-code").click();
	await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
	await expect(page.getByTestId("editor-pane")).toContainText("id: sample-root");
});

test("opens a non-markdown file straight to Monaco with no rendered-view toggle", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });
	await expect(notes).toBeVisible();
	await notes.dblclick();

	await expect(page.getByTestId("editor-tab").filter({ hasText: "notes.txt" })).toBeVisible();
	await expect(page.getByTestId("editor-pane")).toContainText("plain-text-fixture");
	await expect(page.getByTestId("resource-view-toggle")).toHaveCount(0);
	await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
});

test("opens JSON with Tree and Source candidates, defaulting to Tree", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "sample.json" }).dblclick();
	await expect(page.getByTestId("view-toggle-json")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("view-toggle-code")).toBeVisible();
	await expect(page.getByTestId("json-view")).toContainText("sample-project");
	await expect(page.getByTestId("json-dialect")).toHaveCount(0);

	const jsonPath = join(workspace.worktreePath, "sample.json");
	writeFileSync(jsonPath, '{\n  // a note\n  "project": "sample-project",\n}\n');
	await expect(page.getByTestId("json-dialect")).toContainText("Parsed as JSONC");
	await expect(page.getByTestId("json-view")).toContainText("sample-project");

	writeFileSync(jsonPath, "{ not json");
	await expect(page.getByTestId("json-invalid")).toContainText("Not valid JSON");
	await page.getByTestId("view-toggle-code").click();
	await expect(page.locator(".monaco-editor").first()).toBeVisible();
});

test("opens CSV with Table and Source candidates, defaulting to Table", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "sample.csv" }).dblclick();
	await expect(page.getByTestId("view-toggle-csv")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("view-toggle-code")).toBeVisible();
	await expect(page.getByTestId("csv-view")).toContainText("Table");
});

test("opens a notebook with Notebook and Source candidates", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "sample.ipynb" }).dblclick();
	await expect(page.getByTestId("view-toggle-notebook")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("view-toggle-code")).toBeVisible();
	await expect(page.getByTestId("notebook-view")).toContainText("Notebook fixture");
	await expect(page.getByTestId("notebook-view")).toContainText("notebook-output");
	const cellImage = page.getByTestId("notebook-view").locator('img[alt="fixture-logo"]');
	await expect(cellImage).toHaveAttribute("src", /\/files\/[^/]+\/logo\.png$/);
	await expect
		.poll(() => cellImage.evaluate((el: HTMLImageElement) => el.naturalWidth))
		.toBeGreaterThan(0);
});

test("opens an HTML preview with active content disabled", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "sample.html" }).dblclick();
	await expect(page.getByTestId("view-toggle-html")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("view-toggle-code")).toBeVisible();
	await expect(page.getByTestId("html-disabled-notice")).toContainText(
		"Scripts and external resources are disabled",
	);
});

test("opens an uncompressed PDF in the PDF renderer and its change in the PDF diff", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "RENDERERS.pdf" }).dblclick();
	await expect(page.getByTestId("view-toggle-pdf")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("view-toggle-binary")).toBeVisible();
	const firstPage = page.getByTestId("pdf-view").locator("canvas").first();
	await expect(firstPage).toBeVisible();
	await expect
		.poll(() =>
			firstPage.evaluate((element) => {
				const canvas = element as HTMLCanvasElement;
				const pixels = canvas
					.getContext("2d")
					?.getImageData(0, 0, canvas.width, canvas.height).data;
				if (!pixels) return 0;
				let drawn = 0;
				for (let index = 0; index < pixels.length; index += 4) {
					if (pixels[index] < 240) drawn += 1;
				}
				return drawn;
			}),
		)
		.toBeGreaterThan(100);

	writeFileSync(join(workspace.worktreePath, "RENDERERS.pdf"), asciiPdf("CHANGED PDF FIXTURE"));
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "RENDERERS.pdf" }).click();
	await expect(page.getByTestId("pdf-diff")).toBeVisible();
	await expect(page.getByTestId("pdf-diff-page")).toHaveCount(1);
});

test("a PDF zooms under a pinch and its text can be selected", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "RENDERERS.pdf" }).dblclick();

	const canvas = page.getByTestId("pdf-view").locator("canvas").first();
	const rasterWidth = () => canvas.evaluate((element) => (element as HTMLCanvasElement).width);
	await expect.poll(rasterWidth).toBeGreaterThan(0);
	const before = await rasterWidth();
	const level = page.getByTestId("pdf-zoom-level");
	await expect(level).toHaveText("100%");

	// A trackpad pinch reaches the page as a wheel event with ctrlKey set.
	await page.getByTestId("pdf-view").locator("[data-pdf-scroll]").hover();
	await page.keyboard.down("Control");
	await page.mouse.wheel(0, -200);
	await page.keyboard.up("Control");
	await expect(level).not.toHaveText("100%");
	await expect.poll(rasterWidth).toBeGreaterThan(before);
	await level.click();
	await expect(level).toHaveText("100%");

	// The canvas is a picture of the page; the text a reader wants to copy is the layer over it.
	const words = page.getByTestId("pdf-text-layer").first().locator("span");
	await expect(words.filter({ hasText: "RENDERERS PDF" }).first()).toHaveCount(1);
	await page.getByTestId("pdf-select-text").click();
	await expect(page.getByTestId("pdf-select-text")).toHaveAttribute("aria-pressed", "true");
	const selected = await words.first().evaluate((span) => {
		const range = document.createRange();
		range.selectNodeContents(span);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		return selection?.toString() ?? "";
	});
	expect(selected).toContain("RENDERERS PDF");
});

test("a Git LFS pointer shows as a card in the view and per side in the diff, with Source one toggle away", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "LFS-ASSET.png" }).dblclick();
	await expect(page.getByTestId("view-toggle-lfs")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("lfs-pointer")).toContainText("Stored in Git LFS");
	await expect(page.getByTestId("lfs-pointer-size")).toHaveText("12 KB");
	await page.getByTestId("view-toggle-code").click();
	await expect(page.getByTestId("editor-pane")).toContainText("oid sha256:4d7a");

	writeFileSync(join(workspace.worktreePath, "LFS-ASSET.png"), lfsPointer("beef", 4_000_000));
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "LFS-ASSET.png" }).click();
	await expect(page.getByTestId("lfs-diff")).toBeVisible();
	await expect(page.getByTestId("lfs-pointer-original-size")).toHaveText("12 KB");
	await expect(page.getByTestId("lfs-pointer-modified-size")).toHaveText("3.8 MB");
});

test("renders a PNG and opens its changed version in the 2-up image diff", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "RENDERERS.png" }).dblclick();
	await expect(page.getByTestId("view-toggle-image")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("image-resource")).toBeVisible();

	const imagePath = join(workspace.worktreePath, "RENDERERS.png");
	writeFileSync(imagePath, Buffer.concat([readFileSync(imagePath), Buffer.from("changed")]));
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "RENDERERS.png" }).click();
	await expect(page.getByTestId("image-diff-mode")).toBeVisible();
	await expect(page.getByTestId("image-diff-2-up")).toHaveAttribute("data-active", "true");
});

test("an issue number in a stylesheet comment is not painted as a colour", async ({ page }) => {
	writeFileSync(
		join(E2E_FIXTURE_REPO, "issue-130.css"),
		"/** GH #130: per booking form */\na {\n  color: #abc;\n}\n",
	);
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "issue-130.css" }).dblclick();
	const pane = page.getByTestId("editor-pane");
	await expect(pane).toContainText("GH #130");
	await expect(pane).toContainText("color: #abc");
	// Monaco's CSS colour provider would decorate both `#130` and `#abc` once its worker answers; with
	// decorators off, neither ever appears.
	await expect(pane.locator(".colorpicker-color-decoration")).toHaveCount(0);
	await page.waitForTimeout(500);
	await expect(pane.locator(".colorpicker-color-decoration")).toHaveCount(0);
});

test("the markdown outline lists the document's headings and scrolls to one", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "LARGE.md" }).dblclick();
	await expect(page.getByTestId("markdown-preview")).toBeVisible();

	// Off by default, and the toggle belongs to the rendered view only.
	await expect(page.getByTestId("markdown-outline")).toHaveCount(0);
	const toggle = page.getByTestId("md-toggle-outline");
	await expect(toggle).toHaveAttribute("aria-pressed", "false");

	await toggle.click();
	await expect(page.getByTestId("markdown-outline")).toBeVisible();
	const entries = page.getByTestId("markdown-outline-entry");
	await expect(entries.first()).toBeVisible();

	// The entry must link to a heading that actually rendered — the reason the outline is read from the
	// DOM rather than the markdown AST.
	const id = await entries.first().getAttribute("data-heading-id");
	expect(id).toBeTruthy();
	await expect(page.locator(`#user-content-${id}`)).toHaveCount(1);

	// The outline survives every view — in Source it drives the editor jump alone.
	await page.getByTestId("view-toggle-code").click();
	await expect(page.getByTestId("markdown-outline")).toBeVisible();
	await page.getByTestId("view-toggle-markdown").click();
	await expect(page.getByTestId("markdown-outline")).toBeVisible();
});

test("an outline click reveals the heading's line in the source editor", async ({ page }) => {
	writeFileSync(
		join(E2E_FIXTURE_REPO, "toc.md"),
		[
			"# Top",
			"",
			...Array.from({ length: 300 }, (_, at) => `filler ${at}`),
			"",
			"## Deep section",
			"",
			"body",
			"",
		].join("\n"),
	);
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "toc.md" }).dblclick();
	await page.getByTestId("view-toggle-code").click();
	await page.getByTestId("md-toggle-outline").click();

	// Monaco renders only the viewport, so the heading's text appearing is the reveal itself.
	const editorLines = page.getByTestId("editor-pane").locator(".view-lines");
	await expect(editorLines).not.toContainText("Deep section");
	await page.getByTestId("markdown-outline-entry").filter({ hasText: "Deep section" }).click();
	await expect(editorLines).toContainText("## Deep section");
});

test("a wide markdown document stays inside its pane instead of being clipped", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "WIDE.md" }).dblclick();

	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();

	// The scroller must stay inside its pane. A flex item defaults to `min-width:auto` and grows past it
	// instead, which is what clipped headings and prose off the right edge.
	const pane = page.getByTestId("editor-pane").first();
	const paneWidth = (await pane.boundingBox())?.width ?? 0;
	expect(paneWidth).toBeGreaterThan(0);
	expect((await preview.boundingBox())?.width ?? 0).toBeLessThanOrEqual(paneWidth + 1);

	// Prose wraps rather than scrolling: the document itself must not overflow sideways.
	const doc = await preview.evaluate((el) => ({
		scrollWidth: el.scrollWidth,
		clientWidth: el.clientWidth,
	}));
	expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth + 1);

	// A wide table is the exception — it scrolls inside its own box, so the page never has to.
	const table = preview.locator("table").first();
	await expect(table).toBeVisible();
	await expect
		.poll(() => table.evaluate((el) => el.scrollWidth - el.clientWidth))
		.toBeGreaterThan(0);
});

test("the markdown Split view edits and previews at once, and closes back to Source", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(page.getByTestId("markdown-preview")).toContainText("sample-project");

	await page.getByTestId("view-toggle-split").click();
	await expect(page.getByTestId("view-toggle-split")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("embedded-pane-title")).toHaveText("Preview");
	await expect(page.getByTestId("editor-pane")).toContainText("# sample-project");
	await expect(page.getByTestId("markdown-preview")).toContainText("sample-project");

	// Closing the preview half is a deliberate return to plain Source, not a hidden mode.
	await page.getByTestId("embedded-pane-close").click();
	await expect(page.getByTestId("view-toggle-code")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
});
