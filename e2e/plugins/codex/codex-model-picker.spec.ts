import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openTerminal,
	requestOverWire,
	runInTerminal,
	setPluginEnabled,
	waitTerminalReady,
} from "../../fixtures/app";

const FAKE_CODEX = fileURLToPath(
	new URL("../../fixtures/fake-codex-model-picker.ts", import.meta.url),
);

test("the Codex model chip drives /model to a session-only switch", async ({ page }, testInfo) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await requestOverWire(page, "settings.update", {
		config: { plugins: { codex: { hideSubscriptionNotice: true } } },
	});
	await setPluginEnabled(page, "codex", true);
	try {
		await openTerminal(page);
		await waitTerminalReady(page);
		await runInTerminal(
			page,
			`curl -s -o /dev/null -H 'Content-Type: application/json' -d '{"hook_event_name":"SessionStart","session_id":"codex-model-test","model":"gpt-5.6-luna"}' "$THINKRAIL_CODEX_STATUS_URL"`,
		);
		const chip = page.locator('[data-testid="terminal-agent-fact"][data-kind="model"]');
		await expect(chip).toHaveText("gpt-5.6-luna");

		await runInTerminal(page, `bun ${JSON.stringify(FAKE_CODEX)}`);
		await expect(page.getByTestId("terminal-instance")).toContainText("fake-codex ready");
		await chip.click();
		const menu = page.getByTestId("terminal-model-menu");
		await expect(menu.getByRole("menuitem")).toHaveCount(4);
		await expect(menu.locator("svg")).toHaveCount(4);
		await menu.screenshot({ path: testInfo.outputPath("codex-model-menu.png") });
		await menu.getByText("GPT-5.6 Sol", { exact: true }).click();

		// Down to Sol, Enter into its efforts, then s on the highlighted one — never Enter there, which
		// would save the user's default model.
		await expect(page.getByTestId("terminal-instance")).toContainText(
			"Model changed to gpt-5.6-sol medium for this session only",
		);
		await expect(page.getByTestId("terminal-driving-overlay")).toHaveCount(0);
		await expect(chip).toHaveText("gpt-5.6-sol");
	} finally {
		await requestOverWire(page, "settings.update", {
			config: { plugins: { codex: { enabled: false } } },
		});
	}
});
