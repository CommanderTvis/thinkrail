import { seedAnalyticsConsent } from "../../../e2e/fixtures/analyticsConsent";
import { E2E_PORT } from "../../../e2e/fixtures/paths";
import { waitConnected } from "./fixtures/app";
import { expect, test } from "./fixtures/native";

test("privacy controls additional data without disabling basics and persists across reload", async ({ app }) => {
	await seedAnalyticsConsent(`http://127.0.0.1:${E2E_PORT}`, true, true);
	await app.relaunch();
	await waitConnected(app);

	await app.getByTestId("open-settings").click();
	const dialog = app.getByTestId("settings-dialog");
	await expect(dialog).toBeShown();
	await app.getByTestId("settings-nav-privacy").click();
	await expect(dialog).toContainShownText("Usage analytics");

	const toggle = app.getByTestId("analytics-toggle");
	await expect(toggle).toHaveAttr("active", "true");

	await toggle.click();
	await expect(toggle).toHaveAttr("active", "false");
	await expect(dialog).toContainShownText(
		"Share anonymous product usage and how you found ThinkRail. We never collect prompts, code, files, credentials, or account identity.",
	);
	await expect(dialog).toContainShownText("Setup, agent runs, task completions, reviews, and pull-request outcomes.");

	await app.relaunch({ keepPreferences: true });
	await waitConnected(app);
	await app.getByTestId("open-settings").click();
	await app.getByTestId("settings-nav-privacy").click();
	await expect(toggle).toHaveAttr("active", "false");

	await toggle.click();
	await expect(toggle).toHaveAttr("active", "true");
	await expect(app.getByTestId("analytics-consent-dialog")).not.toBeShown();

	await dialog.press("Escape");
	await expect(dialog).not.toBeShown();
});
