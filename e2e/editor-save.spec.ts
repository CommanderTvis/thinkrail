import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

const NOTES = join(E2E_FIXTURE_REPO, "notes.txt");

async function openNotes(page: Page): Promise<void> {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tab-files").click();
	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });
	await expect(notes).toBeVisible();
	await notes.dblclick();
	await expect(page.getByTestId("editor-pane")).toContainText("plain-text-fixture");
}

async function focusEditor(page: Page): Promise<void> {
	const lines = page.getByTestId("editor-pane").locator(".view-lines").first();
	await expect(lines).toBeVisible();
	await lines.click();
}

async function typeAtEnd(page: Page, text: string): Promise<void> {
	await focusEditor(page);
	await page.keyboard.press("ControlOrMeta+End");
	await page.keyboard.type(text);
}

test.beforeEach(() => {
	writeFileSync(NOTES, "plain-text-fixture\n");
});

test.afterEach(() => {
	writeFileSync(NOTES, "plain-text-fixture\n");
});

test("Ctrl+S writes the buffer, and nothing is written until it is pressed", async ({ page }) => {
	await openNotes(page);
	await typeAtEnd(page, "edited by hand");

	await expect(page.getByTestId("file-unsaved-dot")).toBeVisible();
	expect(readFileSync(NOTES, "utf8")).not.toContain("edited by hand");

	await page.keyboard.press("ControlOrMeta+s");
	await expect(page.getByTestId("file-unsaved-dot")).toHaveCount(0);
	await expect.poll(() => readFileSync(NOTES, "utf8")).toContain("edited by hand");
});

test("a file changing under an unsaved buffer is announced, and merges without losing either side", async ({
	page,
}) => {
	await openNotes(page);
	await typeAtEnd(page, "mine");

	writeFileSync(NOTES, "theirs\nplain-text-fixture\n");

	const banner = page.getByTestId("file-disk-changed");
	await expect(banner).toBeVisible();

	await page.getByTestId("file-disk-merge").click();
	await expect(banner).toHaveCount(0);
	await expect
		.poll(() => page.locator(".view-line").allInnerTexts())
		.toEqual(["theirs", "plain-text-fixture", "mine"]);

	await page.keyboard.press("ControlOrMeta+s");
	await expect(page.getByTestId("file-unsaved-dot")).toHaveCount(0);
	const written = readFileSync(NOTES, "utf8");
	expect(written).toContain("theirs");
	expect(written).toContain("mine");
});

test("edits to the same line come back as conflict markers rather than overwriting", async ({
	page,
}) => {
	await openNotes(page);
	// Both sides rewrite the very same line: nothing here can be merged without a choice being made.
	await page.locator(".view-line").first().dblclick();
	await page.keyboard.type("mine");

	writeFileSync(NOTES, "theirs wins?\n");
	await expect(page.getByTestId("file-disk-changed")).toBeVisible();

	await page.keyboard.press("ControlOrMeta+s");

	// Monaco paints spaces as non-breaking ones, so a raw comparison never matches a marker line.
	const lines = async () =>
		(await page.locator(".view-line").allInnerTexts()).map((line) =>
			line.replaceAll("\u00a0", " "),
		);
	await expect.poll(lines).toContain("<<<<<<< your edits");
	await expect.poll(lines).toContain(">>>>>>> on disk");
	await expect.poll(lines).toContain("theirs wins?");
	// The write was refused, so the file still holds only what the other writer put there.
	expect(readFileSync(NOTES, "utf8")).toBe("theirs wins?\n");
	await expect(page.getByTestId("file-unsaved-dot")).toBeVisible();
});

test("closing a tab with unsaved edits asks first", async ({ page }) => {
	await openNotes(page);
	await typeAtEnd(page, "unsaved");

	const tab = page.getByTestId("editor-tab").filter({ hasText: "notes.txt" });
	await tab.getByTestId("editor-tab-close").click();

	await expect(page.getByText("Unsaved changes")).toBeVisible();
	await page.getByTestId("file-discard-confirm").click();
	await expect(tab).toHaveCount(0);
	expect(readFileSync(NOTES, "utf8")).not.toContain("unsaved");
});
