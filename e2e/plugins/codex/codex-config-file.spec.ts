import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	requestOverWire,
	setPluginEnabled,
} from "../../fixtures/app";
import { E2E_CODEX_HOME_DIR } from "../../fixtures/paths";

test("Codex config source opens, saves, and restores without Claude Code", async ({ page }) => {
	const path = join(E2E_CODEX_HOME_DIR, "config.toml");
	const previous = existsSync(path) ? readFileSync(path, "utf8") : null;
	writeFileSync(
		path,
		'model = "config-link-fixture"\napproval_policy = "on-request"\n[features]\nhooks = true\n',
	);
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await setPluginEnabled(page, "claude-code", false);
	await setPluginEnabled(page, "codex", true);
	try {
		const tab = page.getByTestId("tab-plugin:codex:config");
		if ((await tab.count()) === 0) {
			await page.getByTestId("side-group-menu").first().click();
			await page.getByTestId("show-tool-plugin:codex:config").click();
		}
		await tab.first().click();
		await page.getByTestId("codex-surface-settings").click();
		const hooks = page.locator('[data-testid="codex-setting"][data-key="features.hooks"]');
		await hooks.getByTestId("codex-setting-change").click();
		const toggle = page.getByTestId("codex-value-switch");
		await expect(toggle).toHaveAttribute("aria-checked", "true");
		await toggle.click();
		await expect(toggle).toHaveText("false");
		await page.getByTestId("codex-value-continue").click();
		await expect.poll(() => readFileSync(path, "utf8")).toContain("hooks = false");
		await hooks.getByTestId("codex-setting-change").click();
		await expect(toggle).toHaveAttribute("aria-checked", "false");
		await toggle.click();
		await page.getByTestId("codex-value-continue").click();
		await expect.poll(() => readFileSync(path, "utf8")).toContain("hooks = true");
		const model = page.locator('[data-testid="codex-setting"][data-key="model"]');
		await model.getByTestId("codex-setting-change").click();
		await expect(page.getByTestId("codex-value-text")).toHaveValue("config-link-fixture");
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await page
			.locator('[data-testid="codex-setting"][data-key="approval_policy"]')
			.getByTestId("codex-setting-change")
			.click();
		await expect(page.getByTestId("codex-value-choice-on-request")).toBeVisible();
		await expect(page.getByTestId("codex-value-choice-never")).toBeVisible();
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await model.getByTestId("codex-open-source").click();
		const editor = page.getByTestId("editor-pane");
		await expect(editor).toContainText("config-link-fixture");
		await editor.locator(".view-lines").first().click();
		await page.keyboard.press("ControlOrMeta+End");
		await page.keyboard.type("# saved from config link");
		await expect(page.getByTestId("file-unsaved-dot")).toBeVisible();
		expect(readFileSync(path, "utf8")).not.toContain("# saved from config link");
		await page.keyboard.press("ControlOrMeta+s");
		await expect(page.getByTestId("file-unsaved-dot")).toHaveCount(0);
		await expect.poll(() => readFileSync(path, "utf8")).toContain("# saved from config link");
		await page.reload();
		await expect(editor).toContainText("# saved from config link");
		await editor.locator(".view-lines").first().click();
		await page.keyboard.press("ControlOrMeta+End");
		await page.keyboard.type(" after reload");
		await page.keyboard.press("ControlOrMeta+s");
		await expect
			.poll(() => readFileSync(path, "utf8"))
			.toContain("# saved from config link after reload");
		await expect(
			requestOverWire(page, "fs.readFile", {
				workspaceId: workspace.id,
				path: join(E2E_CODEX_HOME_DIR, "auth.json"),
			}),
		).rejects.toThrow("escapes");
		await setPluginEnabled(page, "codex", false);
		await expect(
			requestOverWire(page, "fs.readFile", { workspaceId: workspace.id, path }),
		).rejects.toThrow("escapes");
	} finally {
		await setPluginEnabled(page, "codex", false);
		if (previous === null) rmSync(path, { force: true });
		else writeFileSync(path, previous);
	}
});
