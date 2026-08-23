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
