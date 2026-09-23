import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openTerminal,
	runInTerminal,
	setPluginEnabled,
	visibleTerminal,
	waitTerminalReady,
} from "../../fixtures/app";

const FAKE_REVIEW_AGENT = fileURLToPath(
	new URL("../../fixtures/fake-review-agent.ts", import.meta.url),
);

test.afterEach(async ({ page }) => {
	await setPluginEnabled(page, "claude-code", false);
});

test("a review sent to a Claude Code terminal arrives as one prompt and the agent resolves it over MCP", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await setPluginEnabled(page, "claude-code", true);
	await openTerminal(page);
	await waitTerminalReady(page);
	await runInTerminal(
		page,
		`curl -s -o /dev/null -H 'Content-Type: application/json' -d '{"v":1,"agent":"claude","event":"session_start","session_id":"s-review"}' "$THINKRAIL_AGENT_STATUS_URL"`,
	);
	await expect(page.getByTestId("terminal-agent-facts")).toBeVisible();
	await page.getByTestId("claude-plugin-dismiss").click();
	const terminalTitle = (await page.getByTestId("terminal-tab").last().innerText()).trim();
	const tabKey = await visibleTerminal(page).getAttribute("data-tab-key");
	const agentTerminal = page.locator(`[data-testid="terminal-instance"][data-tab-key="${tabKey}"]`);
	await runInTerminal(page, `bun ${JSON.stringify(FAKE_REVIEW_AGENT)}`);
	await expect(agentTerminal).toContainText("fake-review-agent ready");

	writeFileSync(
		join(workspace.worktreePath, "script.ts"),
		"export const one = 1;\nexport const two = 2;\n",
	);
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await page.getByTestId("diff-pane").getByText("two = 2").last().click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Shift+End");
	await page.locator('[data-testid="review-add-icon"]:visible').click();
	await page.getByTestId("review-composer-input").fill("Rename `two`.");
	await page.getByTestId("review-composer-save").click();

	await page.getByTestId("send-review-button-target").click();
	const target = page.locator('[data-testid="review-send-target"][data-kind="terminal"]');
	await expect(target).toHaveCount(1);
	await expect(target).toContainText(terminalTitle);
	await target.click();

	await expect(agentTerminal).toContainText("paste bracketed: rc_");
	await expect(agentTerminal).toContainText("mcp: Resolved review comment");
	await page.getByTestId("tab-review").click();
	await expect(page.getByTestId("review-comment-resolved")).toHaveCount(1);
});
