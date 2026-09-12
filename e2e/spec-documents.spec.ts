import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

test("a spec is titled by its frontmatter and its [[links]] reach the spec they name", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(
		join(worktree, "SPEC.md"),
		[
			"---",
			"id: sample-root",
			"type: goal-and-requirements",
			"title: Sample Project",
			"---",
			"",
			"## Goal",
			"",
			"Built out of [[sample-module]], and [[no-such-node]] is not here.",
			"",
		].join("\n"),
	);

	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "SPEC.md" }).first().dblclick();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview.getByTestId("spec-title")).toHaveText("Sample Project");

	await page.getByTestId("md-toggle-outline").click();
	await expect(page.getByRole("button", { name: "Sample Project", exact: true })).toBeVisible();

	// A link that names a spec in this workspace opens it; one that names nothing is inert.
	const dangling = preview.getByTestId("markdown-spec-link").filter({ hasText: "no-such-node" });
	await expect(dangling).toBeDisabled();
	await preview.getByTestId("markdown-spec-link").filter({ hasText: "sample-module" }).click();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "SPEC.md" })).toHaveCount(2);
});

test("ordinary markdown keeps its own first heading and leaves [[text]] alone", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(
		join(worktree, "notes.md"),
		["---", "title: Not a spec", "---", "", "## Notes", "", "A [[bracketed]] aside.", ""].join(
			"\n",
		),
	);

	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.md" }).dblclick();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toContainText("[[bracketed]]");
	await expect(preview.getByTestId("markdown-spec-link")).toHaveCount(0);
	await expect(preview.getByTestId("spec-title")).toHaveCount(0);
});
