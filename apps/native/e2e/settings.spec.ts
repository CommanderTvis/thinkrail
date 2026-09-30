import { waitConnected } from "./fixtures/app";
import { expect, test } from "./fixtures/native";

test("settings shows the Local GitHub status block and degrades gh gracefully", async ({ app }) => {
	await app.relaunch();
	await waitConnected(app);

	await app.getByTestId("open-settings").click();
	const dialog = app.getByTestId("settings-dialog");
	await expect(dialog).toBeShown();

	await app.getByTestId("settings-nav-github").click();
	await expect(dialog).toContainShownText("Local GitHub");

	const status = app.getByTestId("settings-gh-status");
	await expect(status).toHaveAttr("connected", "false");
	await expect(status).toContainShownText("Not connected");
	await expect(app.getByTestId("settings-gh-refresh")).toBeShown();

	await app.getByTestId("settings-gh-refresh").click();
	await expect(status).toHaveAttr("connected", "false");

	await dialog.press("Escape");
	await expect(dialog).not.toBeShown();
});
