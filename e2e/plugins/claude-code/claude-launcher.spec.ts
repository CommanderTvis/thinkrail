import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	setPluginEnabled,
	worktreeRows,
} from "../../fixtures/app";

test("the launcher starts Claude Code in its own group, and offers per-run flags on right-click", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page)).toHaveCount(1);

	const launcher = page.getByTestId("new-claude");
	await expect(launcher).toHaveCount(0);

	await setPluginEnabled(page, "claude-code", true);
	await expect(launcher).toBeVisible();

	// The tooltip must hand off to its neighbour: a launcher tooltip that never closes blocks every other.
	await launcher.hover();
	await expect(page.getByRole("tooltip")).toContainText("Start Claude Code");
	await page.getByTestId("new-terminal").hover();
	await expect(page.getByRole("tooltip")).toContainText("New terminal in this group");

	const terminals = page.getByTestId("terminal-tab");
	const before = await terminals.count();

	await launcher.click({ button: "right" });
	const menu = page.getByTestId("claude-launch-menu");
	await expect(menu).toBeVisible();
	await expect(page.getByTestId("claude-launch-continue")).toContainText(
		"Continue the last conversation",
	);
	await expect(page.getByTestId("claude-launch-model-opus")).toBeVisible();

	// Teleport belongs with continue and resume: it picks up a session started somewhere else.
	await expect(page.getByTestId("claude-launch-teleport")).toContainText("Teleport");

	await page.getByTestId("claude-launch-model-opus").click();
	await expect(menu).toBeHidden();
	await expect(terminals).toHaveCount(before + 1);

	// What ThinkRail starts turns the CLI's own view of parallel sessions off: the workspaces are here.
	await expect(
		page
			.getByTestId("terminal-instance")
			.filter({ hasText: "CLAUDE_CODE_DISABLE_AGENT_VIEW=true claude --model opus" }),
	).toHaveCount(1);

	// Unless asked otherwise, and then the line is the plain command again.
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-claude-code").click();
	await page.getByTestId("claude-disable-agent-view").click();
	await expect(page.getByTestId("claude-disable-agent-view")).not.toBeChecked();
	await page.keyboard.press("Escape");
	await launcher.click({ button: "right" });
	await page.getByTestId("claude-launch-model-haiku").click();
	await expect(terminals).toHaveCount(before + 2);
	const plain = page.getByTestId("terminal-instance").filter({ hasText: "claude --model haiku" });
	await expect(plain).toHaveCount(1);
	await expect(plain).not.toContainText("CLAUDE_CODE_DISABLE_AGENT_VIEW");

	// The setting is the host's and outlives this test.
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-claude-code").click();
	await page.getByTestId("claude-disable-agent-view").click();
	await expect(page.getByTestId("claude-disable-agent-view")).toBeChecked();
	await page.keyboard.press("Escape");
});

test("the launch command is a command line, and never reaches a shell blank", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-claude-code").click();

	const command = page.getByTestId("claude-command-input");
	await expect(command).toHaveValue("claude");

	await command.fill("claude --model opus");
	await command.press("Enter");
	await page.keyboard.press("Escape");
	await page.reload();
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-claude-code").click();
	await expect(command).toHaveValue("claude --model opus");

	await command.fill("   ");
	await command.press("Enter");
	await expect(command).toHaveValue("claude");
});
