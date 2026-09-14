import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	loadPersistedWorkspaces,
	openFixtureProject,
	requestOverWire,
	setPluginEnabled,
} from "../../fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO, E2E_HOME_DIR } from "../../fixtures/paths";

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
	test.setTimeout(120_000);
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);

	// `claude` is a stand-in that records its argv and exits — the same trick the config pane's
	// uninstall test uses.
	const log = join(E2E_DATA_DIR, "blueprint-author.log");
	const fake = join(E2E_DATA_DIR, "fake-claude-author");
	writeFileSync(fake, `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\n`);
	chmodSync(fake, 0o755);
	writeFileSync(log, "");
	await setPluginEnabled(page, "claude-code", true);
	await requestOverWire(page, "settings.update", {
		config: { plugins: { "claude-code": { command: fake } } },
	});

	// The workspace action starts a real terminal author, through the Claude launcher's own command
	// composition — the default workspace is the project folder itself.
	await page.getByTestId("workspace-draft-blueprint").click();
	await expect(page.getByTestId("blueprint-start")).toBeVisible();
	await page.locator('[data-testid="blueprint-source"][data-source="product"]').click();
	await page.locator('[data-testid="blueprint-agent"][data-agent="claude"]').click();
	await page.getByTestId("blueprint-start-go").click();
	await expect(page.getByTestId("blueprint-start")).toBeHidden();
	await expect
		.poll(() => readFileSync(log, "utf8"), { timeout: 30_000 })
		.toContain("--append-system-prompt");

	// A terminal author writes with ordinary tools and reports to nobody — the watcher is the only wire.
	writeFileSync(join(E2E_FIXTURE_REPO, "BLUEPRINT.md"), DOC);
	await expect(page.getByTestId("blueprint")).toBeVisible();
	await expect(page.getByTestId("blueprint-document")).toContainText(
		"an author that reports to nobody",
	);

	// A reload brings the author's tab back from the layout, and the companion probes for it again —
	// the pane returns beside its author without opening the file again.
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("blueprint")).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId("blueprint-document")).toContainText(
		"an author that reports to nobody",
	);

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
		join(E2E_FIXTURE_REPO, "BLUEPRINT.md"),
		DOC.replace("reports to nobody", "reports to nobody, twice"),
	);
	await expect(page.getByTestId("blueprint-document")).toContainText("reports to nobody, twice", {
		timeout: 10_000,
	});

	// A report from the author's own terminal records its id onto the blueprint — what a host restart's
	// revive hook needs to offer `--resume` instead of `--continue` (pinned at the host layer, in
	// plugin-blueprint's own host/index.test.ts, since a page reload never restarts the host).
	const sessionId = "11111111-2222-4333-8444-555555555555";
	const author = page.locator('[data-testid="terminal-instance"][data-tab-key="blueprint-author"]');
	await expect(author).toHaveAttribute("data-ready", "true");
	await author.locator(".xterm-helper-textarea").focus();
	await page.keyboard.type(
		`curl -s -o /dev/null -H 'Content-Type: application/json' -d '{"v":1,"agent":"claude","event":"session_start","session_id":"${sessionId}"}' "$THINKRAIL_AGENT_STATUS_URL"`,
	);
	await page.keyboard.press("Enter");
	const defaultWorkspaceId = loadPersistedWorkspaces().find((w) => w.kind === "default")?.id;
	if (!defaultWorkspaceId) throw new Error("no default workspace persisted");
	await expect
		.poll(
			async () => {
				const result = await requestOverWire<{
					state: { author?: { agentSessionId?: string } } | null;
				}>(page, "plugin.blueprint.get", { workspaceId: defaultWorkspaceId });
				return result.state?.author?.agentSessionId;
			},
			{ timeout: 30_000 },
		)
		.toBe(sessionId);
	const project = join(E2E_HOME_DIR, ".claude", "projects", E2E_FIXTURE_REPO.replace(/[/.]/g, "-"));
	mkdirSync(project, { recursive: true });
	writeFileSync(join(project, `${sessionId}.jsonl`), "{}\n");
	await requestOverWire(page, "settings.update", {
		config: { plugins: { "claude-code": { command: "claude" } } },
	});
});

test.afterEach(async ({ page }) => {
	await setPluginEnabled(page, "claude-code", false);
});
