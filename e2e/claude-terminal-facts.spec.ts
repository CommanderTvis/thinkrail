import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openTerminal,
	runInTerminal,
	waitTerminalReady,
} from "./fixtures/app";

const FAKE_EFFORT_SLIDER = fileURLToPath(
	new URL("./fixtures/fake-effort-slider.ts", import.meta.url),
);

const FAKE_MODEL_PICKER = fileURLToPath(
	new URL("./fixtures/fake-model-picker.ts", import.meta.url),
);

/**
 * What the plugin does: POST the report to the address ThinkRail stamped into this terminal. Running it
 * from the terminal itself is the point — it proves the env stamping, not just the endpoint.
 */
function report(fields: Record<string, string>): string {
	const payload = JSON.stringify({ v: 1, agent: "claude", session_id: "s-facts", ...fields });
	return `curl -s -o /dev/null -H 'Content-Type: application/json' -d '${payload}' "$THINKRAIL_AGENT_STATUS_URL"`;
}

async function enableClaudeCode(page: Page): Promise<void> {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-claude-code").click();
	const toggle = page.getByTestId("claude-code-toggle");
	if ((await toggle.getAttribute("data-active")) !== "true") await toggle.click();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
}

test("a file opened over a Claude terminal lands in a column beside it, not over it", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await enableClaudeCode(page);
	// A terminal in the centre, where a file open would otherwise cover it.
	await page.getByTestId("new-terminal").first().click();
	const centre = page.getByTestId("center-group").getByTestId("terminal-instance");
	await expect(centre).toHaveAttribute("data-ready", "true");
	await expect(page.getByTestId("center-group")).toHaveCount(1);
	// The plugin's first report is the witness that Claude runs here (the process poll is a tick behind).
	// Typed into the centre terminal by hand: the workspace's bottom terminal makes the shared helper ambiguous.
	await centre.locator(".xterm-helper-textarea").focus();
	await page.keyboard.type(report({ event: "session_start" }));
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("center-group").getByTestId("terminal-agent-facts")).toBeVisible();

	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	const groups = page.getByTestId("center-group");
	await expect(groups).toHaveCount(2);
	await expect(groups.nth(0).getByTestId("terminal-tab")).toHaveCount(1);
	await expect(groups.nth(0).getByTestId("terminal-tab")).toHaveAttribute("data-active", "true");
	await expect(
		groups.nth(1).getByTestId("editor-tab").filter({ hasText: "README.md" }),
	).toBeVisible();

	// The column exists now, so the next file joins it rather than splitting again.
	await page.getByTestId("file-node").filter({ hasText: "LINKS.md" }).dblclick();
	await expect(groups).toHaveCount(2);
	await expect(
		groups.nth(1).getByTestId("editor-tab").filter({ hasText: "LINKS.md" }),
	).toBeVisible();
});

test.afterEach(async ({ page }) => {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-claude-code").click();
	const toggle = page.getByTestId("claude-code-toggle");
	if ((await toggle.getAttribute("data-active")) === "true") await toggle.click();
	await page.keyboard.press("Escape");
});

test("a Claude terminal says what it is running on, and follows a mid-chat switch", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await enableClaudeCode(page);
	await openTerminal(page);
	await waitTerminalReady(page);

	const facts = page.getByTestId("terminal-agent-facts");
	await expect(facts).toHaveCount(0);

	await runInTerminal(
		page,
		report({ event: "prompt_submit", model: "claude-opus-5", effort: "high" }),
	);
	await expect(facts.locator('[data-kind="model"]')).toHaveText("opus-5");
	await expect(facts.locator('[data-kind="effort"]')).toHaveText("high effort");

	// An event that carries neither leaves the last answer standing rather than blanking the chips.
	await runInTerminal(page, report({ event: "tool_complete" }));
	await expect(facts.locator('[data-kind="model"]')).toHaveText("opus-5");

	// And a switch mid-chat is followed, which is the whole reason these ride the status protocol.
	await runInTerminal(page, report({ event: "stop", model: "claude-sonnet-5", effort: "medium" }));
	await expect(facts.locator('[data-kind="model"]')).toHaveText("sonnet-5");
	await expect(facts.locator('[data-kind="effort"]')).toHaveText("medium effort");

	// A model switch says only that: the chip follows it, the badge does not move.
	await runInTerminal(page, report({ event: "model_switch", model: "claude-opus-5" }));
	await expect(facts.locator('[data-kind="model"]')).toHaveText("opus-5");
	await expect(facts.locator('[data-kind="effort"]')).toHaveText("medium effort");

	// Where the agent started, whole: a session cannot leave it, and half a path names nothing.
	await expect(facts.locator('[data-kind="cwd"]')).toHaveCount(0);
	await runInTerminal(
		page,
		report({ event: "tool_complete", cwd: `${workspace.worktreePath}/nested` }),
	);
	// The label keeps the ends of the path and eats its middle; the whole of it is on hover.
	await expect(facts.locator('[data-kind="cwd"]')).toContainText("nested");
	await expect(facts.locator('[data-kind="cwd"]')).toHaveAttribute(
		"title",
		`Claude started in ${workspace.worktreePath}/nested`,
	);
});

test("the model chip drives the /model picker to a session-only switch", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await enableClaudeCode(page);
	await openTerminal(page);
	await waitTerminalReady(page);

	await runInTerminal(page, report({ event: "prompt_submit", model: "claude-opus-5" }));
	const chip = page.locator('[data-testid="terminal-agent-fact"][data-kind="model"]');
	await expect(chip).toHaveText(/opus-5/);

	// A scripted picker with the real geometry: numbered rows, ❯ on the current model, wrap-around.
	await runInTerminal(page, `bun ${JSON.stringify(FAKE_MODEL_PICKER)}`);
	await expect(page.getByTestId("terminal-instance")).toContainText("fake-model-picker ready");

	await chip.click();
	await page.getByTestId("terminal-model-menu").getByText("Sonnet", { exact: true }).click();
	// The driver arrows the highlight onto Sonnet and presses s — the session-only pick, never Enter
	// or a digit, both of which would overwrite the user's saved default.
	await expect(page.getByTestId("terminal-instance")).toContainText(
		"Set model to Sonnet 5 for this session only",
	);
});

test("the pane is sealed while the picker is being driven", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await enableClaudeCode(page);
	await openTerminal(page);
	await waitTerminalReady(page);

	await runInTerminal(page, report({ event: "prompt_submit", model: "claude-opus-5" }));
	const chip = page.locator('[data-testid="terminal-agent-fact"][data-kind="model"]');
	await expect(chip).toHaveText(/opus-5/);
	await runInTerminal(page, `bun ${JSON.stringify(FAKE_MODEL_PICKER)}`);
	await expect(page.getByTestId("terminal-instance")).toContainText("fake-model-picker ready");

	await chip.click();
	await page.getByTestId("terminal-model-menu").getByText("Sonnet", { exact: true }).click();

	// The drive owns the pty until it is done: a keystroke aimed at it would land between the picker's
	// own, and a click would take the chip out from under it.
	const overlay = page.getByTestId("terminal-driving-overlay");
	await expect(overlay).toBeVisible();
	const box = await chip.boundingBox();
	const onTop = await page.evaluate(
		(point) =>
			document
				.elementFromPoint(point.x, point.y)
				?.closest("[data-testid]")
				?.getAttribute("data-testid"),
		{ x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 },
	);
	expect(onTop).toBe("terminal-driving-overlay");
	await visibleTerminal(page).locator(".xterm-helper-textarea").focus();
	await page.keyboard.type("interference");

	await expect(page.getByTestId("terminal-instance")).toContainText(
		"Set model to Sonnet 5 for this session only",
	);
	await expect(overlay).toHaveCount(0);
	await expect(page.getByTestId("terminal-instance")).not.toContainText("interference");
});

test("the model menu refuses while something is typed at Claude's prompt", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await enableClaudeCode(page);
	await openTerminal(page);
	await waitTerminalReady(page);

	await runInTerminal(page, report({ event: "prompt_submit", model: "claude-opus-5" }));
	const chip = page.locator('[data-testid="terminal-agent-fact"][data-kind="model"]');
	await expect(chip).toHaveText(/opus-5/);
	await runInTerminal(page, `bun ${JSON.stringify(FAKE_MODEL_PICKER)}`);
	await expect(page.getByTestId("terminal-instance")).toContainText("fake-model-picker ready");

	// A half-typed prompt would swallow the slash command, so the menu says so instead of driving.
	await visibleTerminal(page).locator(".xterm-helper-textarea").focus();
	await page.keyboard.type("Docker CI is quite slow");
	await expect(page.getByTestId("terminal-instance")).toContainText("❯ Docker CI is quite slow");
	await chip.click();
	const menu = page.getByTestId("terminal-model-menu");
	await expect(menu.getByTestId("terminal-menu-draft")).toBeVisible();
	await expect(menu.getByText("Sonnet", { exact: true })).toHaveCount(0);
	await page.keyboard.press("Escape");

	// Cleared, the same menu drives the picker again.
	await visibleTerminal(page).locator(".xterm-helper-textarea").focus();
	await page.keyboard.press("Control+u");
	await expect(page.getByTestId("terminal-instance")).not.toContainText("Docker CI is quite slow");
	await chip.click();
	await menu.getByText("Sonnet", { exact: true }).click();
	await expect(page.getByTestId("terminal-instance")).toContainText(
		"Set model to Sonnet 5 for this session only",
	);
});

test("the effort chip drives the /effort slider the same way, session-only", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await enableClaudeCode(page);
	await openTerminal(page);
	await waitTerminalReady(page);

	await runInTerminal(page, report({ event: "prompt_submit", effort: "high" }));
	const chip = page.locator('[data-testid="terminal-agent-fact"][data-kind="effort"]');
	await expect(chip).toHaveText(/high effort/);

	await runInTerminal(page, `bun ${JSON.stringify(FAKE_EFFORT_SLIDER)}`);
	await expect(page.getByTestId("terminal-instance")).toContainText("fake-effort-slider ready");

	await chip.click();
	await page.getByTestId("terminal-effort-menu").getByText("max", { exact: true }).click();
	// The slider is steered by arrows and taken with s — never Enter, which would save a default.
	await expect(page.getByTestId("terminal-instance")).toContainText(
		"Set effort to max for this session only",
	);
	// Nothing reports an effort switch, so the chip takes the pick as soon as the slider confirms it.
	await expect(chip).toHaveText(/max effort/);
});

test("a terminal with no picker to drive gets an Esc and an honest toast", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await enableClaudeCode(page);
	await openTerminal(page);
	await waitTerminalReady(page);

	await runInTerminal(page, report({ event: "prompt_submit", model: "claude-opus-5" }));
	const chip = page.locator('[data-testid="terminal-agent-fact"][data-kind="model"]');
	await chip.click();
	await page.getByTestId("terminal-model-menu").getByText("Sonnet", { exact: true }).click();
	await expect(page.getByTestId("terminal-instance")).toContainText("/model");
	await expect(page.getByTestId("toast").getByText("Couldn't switch the model")).toBeVisible({
		timeout: 15000,
	});
});

test("Claude's TodoWrite plan lives under the terminal, and follows each rewrite", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await enableClaudeCode(page);
	await openTerminal(page);
	await waitTerminalReady(page);

	await runInTerminal(page, report({ event: "prompt_submit", model: "claude-opus-5" }));
	await expect(page.getByTestId("terminal-plan-toggle")).toHaveCount(0);

	const plan = JSON.stringify([
		{ content: "read", status: "completed" },
		{ content: "wire", status: "in_progress", activeForm: "wiring" },
		{ content: "gate", status: "pending" },
	]);
	await runInTerminal(
		page,
		`curl -s -o /dev/null -d '{"v":1,"agent":"claude","event":"tool_complete","tool_name":"TodoWrite","todos":${plan}}' "$THINKRAIL_AGENT_STATUS_URL"`,
	);
	const toggle = page.getByTestId("terminal-plan-toggle");
	await expect(toggle).toHaveText("1/3");

	await toggle.click();
	const items = page.getByTestId("terminal-plan-item");
	await expect(items).toHaveCount(3);
	// The in-progress item speaks in its active form, the way Claude Code's own spinner does.
	await expect(items.nth(1)).toHaveText("wiring");
	await expect(items.nth(1)).toHaveAttribute("data-status", "in_progress");
	await expect(items.nth(0)).toHaveAttribute("data-status", "completed");

	// A report that says nothing about todos leaves the plan standing; a rewrite replaces it whole.
	await runInTerminal(page, report({ event: "tool_complete" }));
	await expect(toggle).toHaveText("1/3");
	await runInTerminal(
		page,
		`curl -s -o /dev/null -d '{"v":1,"agent":"claude","event":"tool_complete","tool_name":"TodoWrite","todos":[{"content":"read","status":"completed"},{"content":"wire","status":"completed"},{"content":"gate","status":"completed"}]}' "$THINKRAIL_AGENT_STATUS_URL"`,
	);
	await expect(toggle).toHaveText("3/3");
	await expect(items).toHaveCount(3);
	await expect(items.nth(2)).toHaveAttribute("data-status", "completed");
});

test("the attach chip types a Claude @path for a file the user picks", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await enableClaudeCode(page);
	await openTerminal(page);
	await waitTerminalReady(page);

	// The chip belongs to a terminal Claude is known to be running in, so it arrives with the first report.
	await expect(page.getByTestId("terminal-attach-file")).toHaveCount(0);
	await runInTerminal(page, report({ event: "session_start", cwd: workspace.worktreePath }));
	await page.getByTestId("terminal-attach-file").click();

	await page.getByTestId("terminal-attach-filter").fill("README");
	await page.getByTestId("terminal-attach-entry").filter({ hasText: "README.md" }).click();
	await expect(page.getByTestId("terminal-instance")).toContainText("@README.md");
});

test("an attached path is written for where the agent is, not where the worktree is", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await enableClaudeCode(page);
	await openTerminal(page);
	await waitTerminalReady(page);

	// Claude started a directory down, so a file at the worktree root is no longer "README.md" to it.
	await runInTerminal(
		page,
		report({ event: "session_start", cwd: `${workspace.worktreePath}/nested` }),
	);
	await page.getByTestId("terminal-attach-file").click();
	await page.getByTestId("terminal-attach-filter").fill("README");
	await page.getByTestId("terminal-attach-entry").filter({ hasText: "README.md" }).click();
	await expect(page.getByTestId("terminal-instance")).toContainText("/README.md");
	await expect(page.getByTestId("terminal-instance")).not.toContainText("@README.md");
});

test("a file outside the worktree is reachable through the host's own picker", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await enableClaudeCode(page);
	await openTerminal(page);
	await waitTerminalReady(page);

	await runInTerminal(page, report({ event: "session_start", cwd: workspace.worktreePath }));
	await page.getByTestId("terminal-attach-file").click();
	await page.getByTestId("terminal-attach-browse").click();
	// The picker answers with an absolute path from anywhere on the host, and it is typed as it stands.
	await expect(page.getByTestId("terminal-instance")).toContainText("@/");
	await expect(page.getByTestId("terminal-instance")).toContainText("outside.md");
});
