import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openTerminal,
	requestOverWire,
	runInTerminal,
	setPluginEnabled,
} from "../../fixtures/app";

test("Codex subscription notice preserves focus and remembers Never show again", async ({
	page,
}, testInfo) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await requestOverWire(page, "settings.update", {
		config: { plugins: { codex: { hideSubscriptionNotice: false } } },
	});
	await setPluginEnabled(page, "codex", true);
	try {
		await openTerminal(page);
		const trigger = page.getByTestId("codex-subscription-notice-trigger");
		const notice = page.getByTestId("codex-subscription-notice");
		await expect(trigger).toHaveCount(0);
		await page
			.getByTestId("terminal-panel")
			.screenshot({ path: testInfo.outputPath("before.png") });
		await runInTerminal(
			page,
			`curl -s -o /dev/null -H 'Content-Type: application/json' -d '{"hook_event_name":"SessionStart","session_id":"codex-subscription-test"}' "$THINKRAIL_CODEX_STATUS_URL"`,
		);
		await expect(notice).toBeVisible();
		await expect(notice).toContainText(
			"Your ChatGPT subscription also works with ThinkRail's Pi GUI",
		);
		await expect(page.locator(".xterm-helper-textarea").last()).toBeFocused();
		await page.screenshot({ path: testInfo.outputPath("after.png") });
		await notice.getByRole("button", { name: "Dismiss", exact: true }).click();
		await expect(notice).toHaveCount(0);
		await trigger.click();
		await expect(notice).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(notice).toHaveCount(0);
		await trigger.click();
		await notice.getByRole("button", { name: "Never show again", exact: true }).click();
		await expect(trigger).toHaveCount(0);
		await expect(notice).toHaveCount(0);
		await page.reload();
		await expect(page.getByTestId("terminal-attach-file")).toBeVisible();
		await expect(trigger).toHaveCount(0);
		await expect(notice).toHaveCount(0);
		await runInTerminal(
			page,
			`curl -s -o /dev/null -H 'Content-Type: application/json' -d '{"hook_event_name":"SessionStart","session_id":"another-codex-session"}' "$THINKRAIL_CODEX_STATUS_URL"`,
		);
		await expect(trigger).toHaveCount(0);
	} finally {
		await requestOverWire(page, "settings.update", {
			config: { plugins: { codex: { enabled: false, hideSubscriptionNotice: false } } },
		});
	}
});
