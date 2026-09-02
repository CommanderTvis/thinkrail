import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, requestOverWire } from "./fixtures/app";
import { E2E_DATA_DIR, E2E_HOME_DIR } from "./fixtures/paths";

const DOC = [
	"---",
	"id: probe",
	"type: goal-and-requirements",
	"title: Probe",
	"---",
	"",
	"## Goal",
	"",
	"A document written by an author that reports to nobody.",
	"",
	"```mermaid",
	"flowchart LR",
	"  author --> file --> pane",
	"```",
	"",
	"> [!NOTE]",
	"> A callout the pane must draw as one.",
	"",
	"```shell",
	"echo probe",
	"```",
	"",
].join("\n");

test("a terminal author's write reaches the pane through the watcher alone", async ({ page }) => {
	// Two real PTY round trips (the restored author's command, then a report typed into it) outgrow
	// the default budget on a cold shell.
	test.setTimeout(120_000);
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);

	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-claude-code").click();
	const toggle = page.getByTestId("claude-code-toggle");
	if ((await toggle.getAttribute("data-active")) !== "true") await toggle.click();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();

	// Reopening the pair types the author's command into a real PTY, so `claude` is a stand-in here that
	// records its argv and exits — the same trick the config pane's uninstall test uses.
	const log = join(E2E_DATA_DIR, "blueprint-author.log");
	const fake = join(E2E_DATA_DIR, "fake-claude-author");
	writeFileSync(fake, `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\n`);
	chmodSync(fake, 0o755);
	writeFileSync(log, "");
	await requestOverWire(page, "settings.update", { config: { claudeCommand: fake } });

	// A terminal author creates no pi session, so nothing else claims the workspace watch for it.
	await requestOverWire(page, "blueprint.open", {
		workspaceId: workspace.id,
		source: { kind: "idea", brief: "probe brief" },
		agentId: "claude",
	});
	await requestOverWire(page, "blueprint.setAuthor", {
		workspaceId: workspace.id,
		author: { kind: "terminal", tabKey: "blueprint-author" },
	});
	writeFileSync(join(workspace.worktreePath, "BLUEPRINT.md"), DOC);

	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "BLUEPRINT.md" }).dblclick();
	await expect(page.getByTestId("blueprint")).toBeVisible();
	await expect(page.getByTestId("blueprint-document")).toContainText(
		"an author that reports to nobody",
	);
	// Opening the pair restores the author and runs its command. With a document on disk and no recorded
	// session, that command continues the worktree's conversation — never the opening prompt, which
	// would tell a fresh author to write the file over this one.
	await expect.poll(() => readFileSync(log, "utf8"), { timeout: 30_000 }).toContain("--continue");
	expect(readFileSync(log, "utf8")).not.toContain("Write the interactive specification");
	// The frontmatter is the same properties table a markdown file gets, and an edit there is staged
	// with the prose edits rather than becoming a tab draft.
	const properties = page.getByTestId("blueprint-document").getByTestId("frontmatter-properties");
	await expect(properties).toBeVisible();
	const title = properties.getByTestId("frontmatter-value").nth(2);
	await expect(title).toHaveValue("Probe");
	await title.fill("Probe, retitled");
	await title.press("Enter");
	await expect(page.getByTestId("blueprint-confirm-edits")).toBeVisible();
	await page.getByTestId("blueprint-discard-edits").click();
	await expect(title).toHaveValue("Probe");

	// Dragging over a passage selects text — it does not flip the passage into its editor when the mouse
	// comes up, which is what let the selection reach the agent through the IDE bridge like any file.
	const passage = page
		.getByTestId("blueprint-document")
		.getByTestId("blueprint-prose")
		.filter({ hasText: "reports to nobody" });
	const words = passage.getByText("an author that reports to nobody");
	const box = await words.boundingBox();
	if (!box) throw new Error("passage not laid out");
	// Along the first line: the passage wraps in the embedded pane, and the vertical middle of a
	// two-line paragraph is the gap between its lines.
	const y = box.y + box.height / 4;
	await page.mouse.move(box.x + 2, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.6, y, { steps: 8 });
	await page.mouse.up();
	await expect
		.poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? ""))
		.not.toBe("");
	await expect(page.getByTestId("blueprint-prose-input")).toHaveCount(0);

	// The same outline a markdown file gets, read from the passages, jumping to the rendered heading.
	await page.getByTestId("blueprint-toggle-outline").click();
	const entry = page.getByTestId("markdown-outline-entry").filter({ hasText: "Goal" });
	await expect(entry).toHaveAttribute("data-heading-id", "goal");
	await entry.click();
	await expect(page.getByTestId("blueprint-document").locator("#goal")).toBeVisible();

	// The dialect the prompt advertises is the dialect the pane renders: callouts included.
	await expect(page.getByTestId("blueprint-document").getByTestId("md-alert")).toContainText(
		"A callout the pane must draw as one.",
	);

	// A diagram is prose to the blueprint parser and a picture to the pane: the fence renders.
	await expect(
		page.getByTestId("blueprint-document").getByTestId("mermaid-svg").locator("svg"),
	).toBeVisible({ timeout: 20_000 });

	// The rewrite arrives with no session and no report — the pane's own watch is the only wire.
	writeFileSync(
		join(workspace.worktreePath, "BLUEPRINT.md"),
		DOC.replace("reports to nobody", "reports to nobody, twice"),
	);
	await expect(page.getByTestId("blueprint-document")).toContainText("reports to nobody, twice", {
		timeout: 10_000,
	});

	// Bringing the author back must never hand an existing document the opening prompt again — that
	// prompt says "write the file". With no recorded id, the worktree's own conversation is continued.
	// The author's PTY is driven over the wire: the report has to come from inside that terminal, since
	// the address it posts to is stamped into the PTY's own environment.
	const cold = await requestOverWire<{ command: string | null }>(page, "blueprint.authorCommand", {
		workspaceId: workspace.id,
	});
	expect(cold.command).toContain("--continue");
	expect(cold.command).not.toContain("Write the interactive specification");

	// A report from the author's own terminal records its id onto the blueprint, and once that
	// conversation is on disk the offer becomes a resume of exactly it. Typed through the page's own
	// terminal — the author's tab, selected by the reopen — because a write from any other client is
	// dropped as displaced.
	const sessionId = "11111111-2222-4333-8444-555555555555";
	const author = page.locator('[data-testid="terminal-instance"][data-tab-key="blueprint-author"]');
	await expect(author).toHaveAttribute("data-ready", "true");
	await author.locator(".xterm-helper-textarea").focus();
	await page.keyboard.type(
		`curl -s -o /dev/null -H 'Content-Type: application/json' -d '{"v":1,"agent":"claude","event":"session_start","session_id":"${sessionId}"}' "$THINKRAIL_AGENT_STATUS_URL"`,
	);
	await page.keyboard.press("Enter");
	await expect
		.poll(
			async () => {
				const state = await requestOverWire<{ author?: { agentSessionId?: string } } | null>(
					page,
					"blueprint.get",
					{ workspaceId: workspace.id },
				);
				return state?.author?.agentSessionId;
			},
			{ timeout: 30_000 },
		)
		.toBe(sessionId);
	const project = join(
		E2E_HOME_DIR,
		".claude",
		"projects",
		workspace.worktreePath.replace(/[/.]/g, "-"),
	);
	mkdirSync(project, { recursive: true });
	writeFileSync(join(project, `${sessionId}.jsonl`), "{}\n");
	const warm = await requestOverWire<{ command: string | null }>(page, "blueprint.authorCommand", {
		workspaceId: workspace.id,
	});
	expect(warm.command).toContain(`--resume ${sessionId}`);
	await requestOverWire(page, "settings.update", { config: { claudeCommand: "claude" } });
});

test.afterEach(async ({ page }) => {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-claude-code").click();
	const toggle = page.getByTestId("claude-code-toggle");
	if ((await toggle.getAttribute("data-active")) === "true") await toggle.click();
	await page.keyboard.press("Escape");
});
