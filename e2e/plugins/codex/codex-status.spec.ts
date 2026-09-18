import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openTerminal,
	runInTerminal,
	setPluginEnabled,
} from "../../fixtures/app";

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
