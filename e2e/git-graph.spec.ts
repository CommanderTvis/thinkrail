import { expect, type Locator, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { gitQuiet as git, gitDatedCommit } from "./fixtures/git";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

/** The graph scrolls in its group's own body, so the wheel is what moves it. */
async function wheelToBottom(page: Page, panel: Locator): Promise<void> {
	const box = await panel.boundingBox();
	await page.mouse.move((box?.x ?? 0) + 40, (box?.y ?? 0) + 80);
	for (let turn = 0; turn < 12; turn++) await page.mouse.wheel(0, 600);
}

test("the graph draws every branch in the project and scopes Changes to a commit", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const long = "a-branch-name-long-enough-to-shove-the-row-sideways";
	git(E2E_FIXTURE_REPO, "branch", long);
	git(E2E_FIXTURE_REPO, "branch", `${long}-and-then-some`);

	await page.getByTestId("side-group-menu").first().click();
	await page.getByTestId("show-tool-graph").click();
	await expect(page.getByTestId("graph-panel")).toBeVisible();

	const commits = page.getByTestId("graph-commit");
	await expect(commits.first()).toBeVisible();
	// The workspace's own branch is a ref on the graph, and its worktree is marked.
	await expect(page.getByTestId("graph-ref").filter({ hasText: workspace.branch })).toHaveCount(1);
	await expect(page.getByTestId("graph-worktree").first()).toBeVisible();

	// Every row draws the same gutter, or the lanes step sideways and the lines break apart.
	const gutters = await page
		.getByTestId("graph-lanes")
		.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
	expect(new Set(gutters).size).toBe(1);
	// And a row is exactly as tall as the lane art, or every line is dashed by the gap between rows.
	const heights = await commits.evaluateAll((nodes) =>
		nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
	);
	expect(new Set(heights)).toEqual(new Set([40]));

	// A long ref gives way rather than pushing the row wider than the rail it lives in.
	await expect(page.getByTestId("graph-ref").filter({ hasText: long }).first()).toBeVisible();
	expect(
		await commits.evaluateAll((rows) =>
			rows.every((row) => row.scrollWidth <= row.clientWidth + 1),
		),
	).toBe(true);

	const sha = await commits.first().getAttribute("data-sha");
	await commits.first().click();
	await page.getByTestId("tab-changes").click();
	// Clicking a commit is the read-only action: Changes now shows that commit's files.
	await expect(page.getByTestId("changes-scope-label")).toContainText(sha ?? "");
});

test("a long history is drawn a window at a time, not all at once", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	for (let i = 0; i < 60; i++)
		git(E2E_FIXTURE_REPO, "commit", "--allow-empty", "-q", "-m", `c${i}`);

	await page.getByTestId("side-group-menu").first().click();
	await page.getByTestId("show-tool-graph").click();
	const panel = page.getByTestId("graph-panel");
	await expect(panel).toBeVisible();

	// The scroller is sized for the whole history; only the rows near the viewport are built.
	await expect.poll(async () => Number(await panel.getAttribute("data-rows"))).toBeGreaterThan(60);
	const rows = Number(await panel.getAttribute("data-rows"));
	expect(await page.getByTestId("graph-commit").count()).toBeLessThan(rows);

	// Scrolling reaches commits that were never drawn to begin with.
	await wheelToBottom(page, panel);
	await expect(page.getByTestId("graph-commit").last()).toContainText("init");
	expect(Number(await panel.getAttribute("data-rows"))).toBeGreaterThan(60);
});

test("the lane gutter is only as wide as the rows on screen need", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	// A burst of branching, dated into the past so it sorts below the tip rather than beside it.
	for (const name of ["old-a", "old-b", "old-c"]) {
		gitDatedCommit(E2E_FIXTURE_REPO, "2001-01-01T00:00:00", name, name);
	}
	for (let i = 0; i < 40; i++)
		git(E2E_FIXTURE_REPO, "commit", "--allow-empty", "-q", "-m", `c${i}`);

	await page.getByTestId("side-group-menu").first().click();
	await page.getByTestId("show-tool-graph").click();
	const panel = page.getByTestId("graph-panel");
	await expect(panel).toBeVisible();

	await expect.poll(async () => Number(await panel.getAttribute("data-rows"))).toBeGreaterThan(40);
	// The tip is one line of history, so the gutter is one lane wide however wide the graph gets below.
	await expect(panel).toHaveAttribute("data-lanes", "1");
	const narrow = await page
		.getByTestId("graph-lanes")
		.first()
		.evaluate((n) => n.clientWidth);

	// Scrolling into the branching widens it, and every row on screen widens together. The branch
	// commits sit above their own parent, which is where in the history they are found.
	const box = await panel.boundingBox();
	await page.mouse.move((box?.x ?? 0) + 40, (box?.y ?? 0) + 80);
	for (let turn = 0; turn < 30 && (await panel.getAttribute("data-lanes")) === "1"; turn++) {
		await page.mouse.wheel(0, 200);
	}
	await expect(panel).not.toHaveAttribute("data-lanes", "1");
	// Polled, because the gutter slides to its new width rather than jumping to it.
	await expect
		.poll(() =>
			page
				.getByTestId("graph-lanes")
				.first()
				.evaluate((n) => n.clientWidth),
		)
		.toBeGreaterThan(narrow);
});
