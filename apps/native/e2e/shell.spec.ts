import { readFileSync } from "node:fs";
import { waitConnected } from "./fixtures/app";
import { expect, test } from "./fixtures/native";

test("renders the branded shell and, with no workspace, the Welcome screen", async ({ app }) => {
	await app.relaunch();

	await expect(app.getByTestId("shell")).toBeShown();
	await expect(app.getByTestId("left-nav")).toBeShown();
	await expect(app.getByTestId("welcome")).toBeShown();
	await expect(app.getByTestId("center-tabs")).toHaveElements(0);
	await expect(app.getByTestId("right-panel")).toHaveElements(0);

	const manifest = JSON.parse(
		readFileSync(new URL("../../web/src/themes/bundled/dark.theme.json", import.meta.url), "utf8"),
	) as { colors: { accent: string } };
	const logo = app.getByTestId("brand-logo");
	await expect(logo).toBeShown();
	await expect(logo).toHaveAttr("label", "ThinkRail");
	await expect(logo).toHaveAttr("color", manifest.colors.accent);
	const logoBox = await logo.boundingBox();
	expect(logoBox.height).toBeCloseTo(32, 0);
	expect(logoBox.width).toBeCloseTo(32, 0);

	await waitConnected(app);
	await expect(app.getByTestId("connection-status")).toHaveAttr("label", "Connected");
});
