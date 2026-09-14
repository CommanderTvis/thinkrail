import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	requestOverWire,
	setPluginEnabled,
} from "../../fixtures/app";
import { E2E_PLUGIN_DIR } from "../../fixtures/paths";

const FIXTURE_ID = "e2e-fixture";

function pluginRow(page: Page, id: string) {
	return page.locator(`[data-testid="settings-plugins-row"][data-plugin-id="${id}"]`);
}

/** Points the host at this lane's plugin root and re-discovers it — the fixture ships disabled either way. */
async function pointAtFixtureRoot(page: Page): Promise<void> {
	await requestOverWire(page, "settings.update", { config: { pluginPaths: [E2E_PLUGIN_DIR] } });
	await requestOverWire(page, "plugins.rescan", {});
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-plugins").click();
}

test.afterEach(async ({ page }) => {
	await setPluginEnabled(page, FIXTURE_ID, false).catch(() => {});
	await requestOverWire(page, "settings.update", { config: { pluginPaths: [] } }).catch(() => {});
});

test("the roster lists a discovered external plugin as disabled", async ({ page }) => {
	await openFixtureProject(page);
	await pointAtFixtureRoot(page);
	const row = pluginRow(page, FIXTURE_ID);
	await expect(row).toHaveAttribute("data-status", "disabled");
	await expect(row).toContainText("external");
	await expect(row).toContainText("v0.1.0");
	await expect(pluginRow(page, "pdf-preview")).not.toContainText(/\bv\d/);
	await page.keyboard.press("Escape");
});

test("enabling mounts its settings section and its side tool, and its method answers over the wire", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await pointAtFixtureRoot(page);
	await page.keyboard.press("Escape");

	await setPluginEnabled(page, FIXTURE_ID, true);

	await page.getByTestId("open-settings").click();
	await page.getByTestId(`settings-nav-${FIXTURE_ID}`).click();
	await expect(page.getByTestId("e2e-fixture-label-input")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();

	const tool = `plugin:${FIXTURE_ID}:panel`;
	const tab = page.getByTestId(`tab-${tool}`);
	if ((await tab.count()) === 0) {
		await page.getByTestId("side-group-menu").first().click();
		await page.getByTestId(`show-tool-${tool}`).click();
	}
	await tab.first().click();
	await expect(page.getByTestId("e2e-fixture-panel")).toBeVisible();

	await page.getByTestId("e2e-fixture-echo-button").click();
	await expect(page.getByTestId("e2e-fixture-echo-result")).toHaveText("echo: hi");
});

test("disabling unmounts the side tool and the method reports disabled", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await pointAtFixtureRoot(page);
	await page.keyboard.press("Escape");
	await setPluginEnabled(page, FIXTURE_ID, true);

	const tool = `plugin:${FIXTURE_ID}:panel`;
	const tab = page.getByTestId(`tab-${tool}`);
	if ((await tab.count()) === 0) {
		await page.getByTestId("side-group-menu").first().click();
		await page.getByTestId(`show-tool-${tool}`).click();
	}
	await tab.first().click();
	await expect(page.getByTestId("e2e-fixture-panel")).toBeVisible();

	await setPluginEnabled(page, FIXTURE_ID, false);
	await expect(page.getByTestId("plugin-tool-dormant")).toContainText("is off");

	await expect(requestOverWire(page, `plugin.${FIXTURE_ID}.echo`, { text: "hi" })).rejects.toThrow(
		/disabled/,
	);
});

test("a manifest with a mismatched API generation is refused, naming both generations", async ({
	page,
}) => {
	const brokenDir = join(E2E_PLUGIN_DIR, "e2e-fixture-broken");
	mkdirSync(brokenDir, { recursive: true });
	writeFileSync(
		join(brokenDir, "thinkrail-plugin.json"),
		JSON.stringify({
			id: "e2e-fixture-broken",
			label: "Broken Fixture",
			icon: "puzzle",
			version: "0.1.0",
			apiGeneration: 999,
			wireVersion: 1,
			enabledByDefault: false,
			dependsOn: [],
			contributes: { sideTools: [], fileViewers: [] },
		}),
	);

	try {
		await openFixtureProject(page);
		await pointAtFixtureRoot(page);
		// A manifest that never gets this far is keyed by its directory rather than its own (untrusted)
		// id — see registerRefusedExternal in packages/server/src/plugins/registry.ts.
		const row = pluginRow(page, "__refused:e2e-fixture-broken");
		await expect(row).toHaveAttribute("data-status", "refused");
		await expect(row).toContainText("999");
		await expect(row).toContainText("expects 1");
		await page.keyboard.press("Escape");
	} finally {
		rmSync(brokenDir, { recursive: true, force: true });
	}
});

test("a plugin directory removed from disk disappears after a rescan", async ({ page }) => {
	const removableDir = join(E2E_PLUGIN_DIR, "e2e-fixture-removable");
	mkdirSync(removableDir, { recursive: true });
	writeFileSync(
		join(removableDir, "thinkrail-plugin.json"),
		JSON.stringify({
			id: "e2e-fixture-removable",
			label: "Removable Fixture",
			icon: "puzzle",
			version: "0.1.0",
			apiGeneration: 1,
			wireVersion: 1,
			enabledByDefault: false,
			dependsOn: [],
			contributes: { sideTools: [], fileViewers: [] },
		}),
	);

	try {
		await openFixtureProject(page);
		await pointAtFixtureRoot(page);
		await expect(pluginRow(page, "e2e-fixture-removable")).toBeVisible();

		rmSync(removableDir, { recursive: true, force: true });
		await requestOverWire(page, "plugins.rescan", {});
		await expect(pluginRow(page, "e2e-fixture-removable")).toHaveCount(0);
		await page.keyboard.press("Escape");
	} finally {
		rmSync(removableDir, { recursive: true, force: true });
	}
});
