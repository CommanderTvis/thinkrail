import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { minimalPdf } from "./fixtures/repo";

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
	await expect(page.getByTestId("md-toggle-preview")).toHaveAttribute("data-active", "true");

	await page.getByTestId("md-toggle-source").click();
	await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
	await expect(page.getByTestId("editor-pane")).toContainText("# sample-project");
	await page.getByTestId("md-toggle-preview").click();
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

	await page.getByTestId("md-toggle-source").click();
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
	await expect(page.getByTestId("markdown-view-toggle")).toHaveCount(0);
	await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
});

test("a PDF renders through pdf.js, and zooming re-rasterizes it larger", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	const pdf = page.getByTestId("file-node").filter({ hasText: "sample.pdf" });
	await expect(pdf).toBeVisible();
	await pdf.dblclick();

	await expect(page.getByTestId("editor-tab").filter({ hasText: "sample.pdf" })).toBeVisible();
	// Proves the worker asset resolved and a page actually rasterized — neither is visible to typecheck.
	const canvas = page.getByTestId("pdf-page").first();
	await expect(canvas).toBeVisible();
	const before = await canvas.evaluate((el) => (el as HTMLCanvasElement).width);
	expect(before).toBeGreaterThan(0);

	await expect(page.getByTestId("pdf-zoom-level")).toHaveText("100%");
	await page.getByTestId("pdf-zoom-in").click();
	await expect(page.getByTestId("pdf-zoom-level")).not.toHaveText("100%");
	await expect
		.poll(async () => canvas.evaluate((el) => (el as HTMLCanvasElement).width))
		.toBeGreaterThan(before);

	await page.getByTestId("pdf-zoom-reset").click();
	await expect(page.getByTestId("pdf-zoom-level")).toHaveText("100%");

	// The canvas is a picture of the page; the text a reader wants to copy is the layer over it.
	const words = page.getByTestId("pdf-text-layer").first().locator("span");
	await expect(words.filter({ hasText: "ThinkRail PDF" }).first()).toHaveCount(1);
	const selected = await words.first().evaluate((span) => {
		const range = document.createRange();
		range.selectNodeContents(span);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		return selection?.toString() ?? "";
	});
	expect(selected).toContain("ThinkRail PDF");

	// A PDF is not text: the markdown chrome does not belong to it, and it owns its own toolbar instead.
	await expect(page.getByTestId("markdown-view-toggle")).toHaveCount(0);
	await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
	await expect(page.getByTestId("pdf-toolbar")).toBeVisible();
});

test("an image opens as a rendered preview, not a Monaco buffer of bytes", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "logo.png" }).dblclick();

	await expect(page.getByTestId("editor-tab").filter({ hasText: "logo.png" })).toBeVisible();
	const img = page.getByTestId("image-preview-img");
	await expect(img).toBeVisible();
	// Proves the bytes actually decoded over the /files route — a broken img element is still "visible".
	await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
	await expect(page.getByTestId("image-preview-size")).toHaveText("1 × 1");

	// The PDF viewer's zoom vocabulary, same gestures, same buttons.
	await expect(page.getByTestId("image-zoom-level")).toHaveText("100%");
	await page.getByTestId("image-zoom-in").click();
	await expect(page.getByTestId("image-zoom-level")).toHaveText("115%");
	await page.getByTestId("image-zoom-reset").click();
	await expect(page.getByTestId("image-zoom-level")).toHaveText("100%");

	// A picture is not text: no markdown chrome, no editor.
	await expect(page.getByTestId("markdown-view-toggle")).toHaveCount(0);
	await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
});

test("a rewritten image shows its new pixels without reopening the tab", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "logo.png" }).dblclick();
	await expect(page.getByTestId("image-preview-size")).toHaveText("1 × 1");

	// A 2×1 replacement: the dimensions caption changing is the reload, observed end to end.
	const twoByOne = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4z8AARAAI/gH/xp559wAAAABJRU5ErkJggg==",
		"base64",
	);
	const target = join(workspace.worktreePath, "logo.png");
	writeFileSync(target, twoByOne);
	await expect(page.getByTestId("image-preview-size")).toHaveText("2 × 1", { timeout: 10_000 });

	// The way an exporter does it: the file goes away and comes back under a rename.
	const temp = `${target}.tmp`;
	rmSync(target);
	writeFileSync(
		temp,
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAoGB9x0AAAAASUVORK5CYII=",
			"base64",
		),
	);
	renameSync(temp, target);
	await expect(page.getByTestId("image-preview-size")).toHaveText("1 × 1", { timeout: 10_000 });
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
	await expect(page.locator(`#${id}`)).toHaveCount(1);

	// The outline survives every view — in Source it drives the editor jump alone.
	await page.getByTestId("md-toggle-source").click();
	await expect(page.getByTestId("markdown-outline")).toBeVisible();
	await page.getByTestId("md-toggle-preview").click();
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
	await page.getByTestId("md-toggle-source").click();
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

test("a rewritten PDF shows its new bytes without reopening the tab", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "sample.pdf" }).dblclick();
	const firstWord = page.getByTestId("pdf-text-layer").first().locator("span").first();
	await expect(firstWord).toContainText("ThinkRail PDF");

	const target = join(workspace.worktreePath, "sample.pdf");
	writeFileSync(target, minimalPdf().replace("(ThinkRail PDF)", "(Recompiled now)"), "latin1");
	await expect(firstWord).toContainText("Recompiled now", { timeout: 10_000 });

	// The way a compiler does it: the file goes away and comes back under a rename.
	const temp = `${target}.tmp`;
	rmSync(target);
	writeFileSync(temp, minimalPdf().replace("(ThinkRail PDF)", "(Second pass)"), "latin1");
	renameSync(temp, target);
	await expect(firstWord).toContainText("Second pass", { timeout: 10_000 });

	// And the toolbar can ask again, for the bytes a watch never told us about.
	writeFileSync(target, minimalPdf().replace("(ThinkRail PDF)", "(By hand)"), "latin1");
	await page.getByTestId("pdf-reload").click();
	await expect(firstWord).toContainText("By hand", { timeout: 10_000 });
});

test("word wrap is a setting, and the editor follows it live", async ({ page }) => {
	writeFileSync(
		join(E2E_FIXTURE_REPO, "long-line.txt"),
		`${"длинная строка про шпеци и дегустацию ".repeat(40).trim()}\n`,
	);
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "long-line.txt" }).dblclick();

	const line = page.locator(".monaco-editor .view-line").first();
	await expect(line).toBeVisible();
	const unwrapped = await page.locator(".monaco-editor .view-line").count();

	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-editor").click();
	await page.getByTestId("editor-word-wrap").click();
	// Controlled by host-saved settings, so the box only ticks once the round trip lands.
	await expect(page.getByTestId("editor-word-wrap")).toBeChecked();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toHaveCount(0);

	// One logical line becomes many view lines only when the editor soft-wraps it.
	await expect
		.poll(async () => page.locator(".monaco-editor .view-line").count())
		.toBeGreaterThan(unwrapped);

	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-editor").click();
	await page.getByTestId("editor-word-wrap").click();
	await expect(page.getByTestId("editor-word-wrap")).not.toBeChecked();
	await page.keyboard.press("Escape");
});

test("the markdown Split view edits and previews at once, and closes back to Source", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(page.getByTestId("markdown-preview")).toContainText("sample-project");

	await page.getByTestId("md-toggle-split").click();
	await expect(page.getByTestId("md-toggle-split")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("embedded-pane-title")).toHaveText("Preview");
	await expect(page.getByTestId("markdown-preview")).toContainText("sample-project");
	await expect(page.getByTestId("editor-pane")).toContainText("# sample-project");

	// Closing the preview half is a deliberate return to plain Source, not a hidden mode.
	await page.getByTestId("embedded-pane-close").click();
	await expect(page.getByTestId("md-toggle-source")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
});
