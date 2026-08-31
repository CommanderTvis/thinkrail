import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

const DOC = [
	"---",
	"title: Green talk",
	"tags:",
	"  - talk",
	"  - latex",
	"---",
	"",
	"# Notes",
	"",
];

async function openPropsDoc(page: Page): Promise<void> {
	writeFileSync(join(E2E_FIXTURE_REPO, "props.md"), DOC.join("\n"));
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "props.md" }).dblclick();
	await expect(page.getByTestId("frontmatter-properties")).toBeVisible();
}

test("frontmatter renders as editable properties, and an edit lands in the draft", async ({
	page,
}) => {
	await openPropsDoc(page);

	const title = page.getByTestId("frontmatter-value");
	await expect(title).toHaveValue("Green talk");
	await expect(page.getByTestId("frontmatter-list-item")).toHaveCount(2);

	await title.fill("Amber talk");
	await title.press("Enter");
	await expect(title).toHaveValue("Amber talk");
	// The edit is a draft like any typed one: the tab is dirty until saved, and Source shows the YAML.
	await expect(page.getByTestId("file-unsaved-dot")).toBeVisible();
	await page.getByTestId("md-toggle-source").click();
	await expect(page.getByTestId("editor-pane")).toContainText("title: Amber talk");
});

test("list chips add and remove, and the block folds away", async ({ page }) => {
	await openPropsDoc(page);

	await page.getByTestId("frontmatter-list-add").fill("beamer");
	await page.getByTestId("frontmatter-list-add").press("Enter");
	await expect(page.getByTestId("frontmatter-list-item")).toHaveCount(3);
	await page.getByRole("button", { name: "Remove talk", exact: true }).click();
	await expect(page.getByTestId("frontmatter-list-item")).toHaveCount(2);

	await page.getByTestId("frontmatter-toggle").click();
	await expect(page.getByTestId("frontmatter-value")).toHaveCount(0);
	await page.getByTestId("frontmatter-toggle").click();
	await expect(page.getByTestId("frontmatter-value")).toBeVisible();
});

test("the type menu converts between text, sequence, and mapping", async ({ page }) => {
	await openPropsDoc(page);
	const rows = page.getByTestId("frontmatter-property");

	await rows.nth(1).getByTestId("frontmatter-type").click();
	await page.getByTestId("frontmatter-type-text").click();
	await expect(rows.nth(1).getByTestId("frontmatter-value")).toHaveValue("[talk, latex]");

	await rows.nth(0).getByTestId("frontmatter-type").click();
	await page.getByTestId("frontmatter-type-sequence").click();
	await expect(rows.nth(0).getByTestId("frontmatter-list-item")).toHaveText("Green talk");

	await rows.nth(0).getByTestId("frontmatter-type").click();
	await page.getByTestId("frontmatter-type-mapping").click();
	await expect(rows.nth(0).getByTestId("frontmatter-map-key")).toHaveValue("1");
	await expect(rows.nth(0).getByTestId("frontmatter-map-value")).toHaveValue("Green talk");

	// A mapping edits per entry, and the write lands in the source like any other draft.
	await rows.nth(0).getByTestId("frontmatter-map-value").fill("Amber talk");
	await rows.nth(0).getByTestId("frontmatter-map-value").press("Enter");
	await page.getByTestId("md-toggle-source").click();
	await expect(page.getByTestId("editor-pane")).toContainText("1: Amber talk");
});

test("a type property offers the spec vocabulary as suggestions", async ({ page }) => {
	writeFileSync(
		join(E2E_FIXTURE_REPO, "props.md"),
		["---", "type: module-design", "---", "", "# Notes", ""].join("\n"),
	);
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "props.md" }).dblclick();

	const value = page.getByTestId("frontmatter-value");
	await expect(value).toHaveValue("module-design");
	const listId = await value.getAttribute("list");
	expect(listId).toBeTruthy();
	await expect(page.locator(`datalist[id="${listId}"] option[value="task-spec"]`)).toHaveCount(1);
});

test("a block the editor cannot speak renders read-only instead of guessing", async ({ page }) => {
	writeFileSync(
		join(E2E_FIXTURE_REPO, "props.md"),
		["---", "nested:", "  child:", "    deep: x", "---", "", "# Notes", ""].join("\n"),
	);
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "props.md" }).dblclick();

	await expect(page.getByTestId("frontmatter-properties")).toBeVisible();
	await expect(page.getByTestId("frontmatter-properties")).toContainText("deep: x");
	await expect(page.getByTestId("frontmatter-value")).toHaveCount(0);
	await expect(page.getByTestId("frontmatter-add")).toHaveCount(0);
});
