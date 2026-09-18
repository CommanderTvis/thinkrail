import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openTerminal,
	runInTerminal,
	setPluginEnabled,
	worktreeRows,
} from "../../fixtures/app";

test("Codex IDE chips submit commands separately from text, including after remount", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await setPluginEnabled(page, "codex", true);
	try {
		await openTerminal(page);
		const fixture = fileURLToPath(
			new URL("../../fixtures/codex-command-input.ts", import.meta.url),
		);
		await runInTerminal(page, `bun ${JSON.stringify(fixture)}`);
		const terminal = page.getByTestId("terminal-instance");
		await expect(terminal).toContainText("codex command input ready");
		const chip = page.getByTestId("terminal-ide-context-toggle");
		await expect(chip).toHaveAttribute("data-enabled", "false");
		await chip.dblclick();
		await expect(terminal).toContainText('SUBMITTED 1: "/ide on"');
		await expect(chip).toHaveAttribute("data-enabled", "true");
		await chip.click();
		await expect(terminal).toContainText('SUBMITTED 2: "/ide off"');
		await expect(chip).toHaveAttribute("data-enabled", "false");

		await page.getByTestId("project-item").first().click();
		await expect(page.getByTestId("terminal-panel")).toHaveCount(0);
		await worktreeRows(page).first().getByRole("button").first().click();
		await expect(terminal).toContainText('SUBMITTED 2: "/ide off"');
		await chip.click();
		await expect(terminal).toContainText('SUBMITTED 3: "/ide on"');
		await expect(chip).toHaveAttribute("data-enabled", "true");
	} finally {
		await setPluginEnabled(page, "codex", false);
	}
});

test("Codex action required is an accessible icon beside the task title", async ({
	page,
}, testInfo) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await setPluginEnabled(page, "codex", true);
	try {
		await openTerminal(page);
		await runInTerminal(
			page,
			`curl -s -o /dev/null -H 'Content-Type: application/json' -d '{"hook_event_name":"PermissionRequest","session_id":"codex-status-test"}' "$THINKRAIL_CODEX_STATUS_URL"`,
		);
		const badge = page.getByTestId("terminal-codex-status");
		await expect(badge).toHaveAttribute("data-status", "blocked");
		const ideContext = page.getByTestId("terminal-ide-context-toggle");
		await expect(ideContext).toHaveAttribute("data-enabled", "false");
		await ideContext.click();
		await expect(ideContext).toHaveAttribute("data-enabled", "true");
		await ideContext.click();
		await expect(ideContext).toHaveAttribute("data-enabled", "false");
		await runInTerminal(
			page,
			"printf '\\033]0;[ ! ] Action Required | Describe the image | my-workspace\\007'",
		);
		const tab = page.getByTestId("terminal-tab").filter({ has: badge });
		await expect(tab).toContainText("Describe the image | my-workspace");
		await expect(tab).not.toContainText("Action Required");
		await expect(tab).not.toContainText("! ]");
		await expect(badge).toHaveAccessibleName("Codex: Action required");
		await expect(badge).toHaveAttribute("title", "Codex: Action required");
		await expect(badge.locator("svg")).toBeVisible();
		await tab.screenshot({ path: testInfo.outputPath("codex-action-required.png") });
		await runInTerminal(
			page,
			`curl -s -o /dev/null -H 'Content-Type: application/json' -d '{"hook_event_name":"PostToolUse","session_id":"codex-status-test"}' "$THINKRAIL_CODEX_STATUS_URL"`,
		);
		await expect(badge).toHaveAttribute("data-status", "running");
		await expect(badge.locator("svg")).toHaveCount(0);
	} finally {
		await setPluginEnabled(page, "codex", false);
	}
});

test("a Codex terminal shows its session's token totals and plan from its rollout", async ({
	page,
}, testInfo) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await setPluginEnabled(page, "codex", true);
	try {
		await openTerminal(page);
		const rollout = testInfo.outputPath("rollout.jsonl");
		writeFileSync(
			rollout,
			[
				{
					type: "response_item",
					payload: {
						type: "function_call",
						name: "update_plan",
						arguments: JSON.stringify({
							plan: [
								{ step: "Read the code", status: "completed" },
								{ step: "Fix it", status: "in_progress" },
							],
						}),
					},
				},
				{
					type: "event_msg",
					payload: {
						type: "token_count",
						info: {
							total_token_usage: {
								input_tokens: 23_611,
								cached_input_tokens: 11_008,
								cache_write_input_tokens: 0,
								output_tokens: 33,
							},
						},
					},
				},
			]
				.map((line) => `${JSON.stringify(line)}\n`)
				.join(""),
		);
		const hook = JSON.stringify({
			hook_event_name: "PostToolUse",
			session_id: "codex-usage-test",
			transcript_path: rollout,
		});
		await runInTerminal(
			page,
			`curl -s -o /dev/null -H 'Content-Type: application/json' -d '${hook}' "$THINKRAIL_CODEX_STATUS_URL"`,
		);
		const usage = page.locator('[data-testid="terminal-agent-fact"][data-kind="usage"]');
		await expect(usage).toHaveText("↑13k · ↓33 · R11k");
		await expect(usage).not.toHaveAttribute("title");
		await usage.hover();
		await expect(page.getByRole("tooltip")).toContainText("Tokens this Codex session has spent");
		const toggle = page.getByTestId("terminal-plan-toggle");
		await expect(toggle).toHaveText("1/2");
		await toggle.click();
		await expect(page.getByTestId("terminal-plan-item")).toHaveText(["Read the code", "Fix it"]);
	} finally {
		await setPluginEnabled(page, "codex", false);
	}
});
