import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, requestOverWire } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

async function setClaudeCode(page: Page, on: boolean): Promise<void> {
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await page.getByTestId("settings-nav-claude-code").click();
	const toggle = page.getByTestId("claude-code-toggle");
	if ((await toggle.getAttribute("data-active")) !== String(on)) await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", String(on));
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
}

// The switch lives in host settings, which outlive a test's state reset — so this spec hands the lane
// back the way it found it rather than leaving the integration on for whatever runs next.
test.afterEach(async ({ page }) => {
	await setClaudeCode(page, false);
});

async function openClaudePane(page: Page): Promise<void> {
	await setClaudeCode(page, true);

	// The pane is not docked by default; it is revealed from the side group's menu like any other tool.
	const tab = page.getByTestId("tab-claude");
	if ((await tab.count()) === 0) {
		await page.getByTestId("side-group-menu").first().click();
		await page.getByTestId("show-tool-claude").click();
	}
	await tab.first().click();
	await expect(page.getByTestId("claude-config-panel")).toBeVisible();
	// The mark is lit while its tab is the active one (a rested tab draws it in the strip's ink).
	await expect(tab.first().locator(".text-agent-claude")).toHaveCount(1);
}

function readJson(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

test("a list setting is composed entry by entry, empty rows dropped", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await openClaudePane(page);

	await page.getByTestId("claude-surface-settings").click();
	await page.getByTestId("claude-setting-add").click();
	await page.getByTestId("claude-value-key").fill("env.probe");
	await page.getByTestId("claude-value-shape-list").click();

	const entries = page.getByTestId("claude-value-list-entry");
	await entries.first().fill("first entry, a whole sentence");
	await page.getByTestId("claude-value-list-add").click();
	await page.getByTestId("claude-value-list-add").click();
	await expect(entries).toHaveCount(3);
	await entries.nth(2).fill("third");
	await page.getByTestId("claude-value-list-remove").nth(2).click();
	await expect(entries).toHaveCount(2);

	await page.getByTestId("claude-value-continue").click();
	await page.getByTestId("claude-edit-scope-project").click();
	const diff = page.getByTestId("claude-edit-diff");
	// The empty middle row is dropped rather than written as "".
	await expect(diff).toContainText("first entry, a whole sentence");
	await expect(diff).not.toContainText('""');
	await page.keyboard.press("Escape");
	await expect(diff).toHaveCount(0);
});

test("a settings value is composed, scoped, shown as a diff, and only then written", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await openClaudePane(page);

	await page.getByTestId("claude-surface-settings").click();
	await page.getByTestId("claude-setting-add").click();
	await page.getByTestId("claude-value-key").fill("cleanupPeriodDays");
	await page.getByTestId("claude-value-shape-number").click();
	await page.getByTestId("claude-value-text").fill("14");
	await page.getByTestId("claude-value-continue").click();

	// Nothing is planned until a scope is chosen: no diff, and no way to apply.
	const apply = page.getByTestId("claude-edit-apply");
	await expect(page.getByTestId("claude-edit-diff")).toHaveCount(0);
	await expect(apply).toBeDisabled();

	await page.getByTestId("claude-edit-scope-project").click();
	const diff = page.getByTestId("claude-edit-diff");
	await expect(diff).toBeVisible();
	await expect(diff).toContainText("cleanupPeriodDays");
	await expect(
		diff.locator('[data-kind="add"]').filter({ hasText: "cleanupPeriodDays" }),
	).toContainText('"cleanupPeriodDays": 14');

	await apply.click();
	await expect(page.getByTestId("claude-edit-diff")).toHaveCount(0);

	const settingsPath = join(workspace.worktreePath, ".claude", "settings.json");
	await expect(async () => {
		expect(readJson(settingsPath).cleanupPeriodDays).toBe(14);
	}).toPass({ timeout: 10_000 });

	const row = page.locator('[data-testid="claude-setting"][data-key="cleanupPeriodDays"]');
	await expect(row).toBeVisible();
	await expect(row).toContainText("14");

	// Removing is the same journey, and the diff has to show the line going away.
	await row.getByTestId("claude-setting-remove").click();
	await page.getByTestId("claude-edit-scope-project").click();
	await expect(
		page.getByTestId("claude-edit-diff").locator('[data-kind="remove"]').filter({
			hasText: "cleanupPeriodDays",
		}),
	).toHaveCount(1);
	await page.getByTestId("claude-edit-apply").click();
	await expect(async () => {
		expect(readJson(settingsPath).cleanupPeriodDays).toBeUndefined();
	}).toPass({ timeout: 10_000 });
});

test("an MCP server is added to the project's own file, then switched off from the same pane", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await openClaudePane(page);

	await page.getByTestId("claude-surface-capabilities").click();
	await page.getByTestId("claude-add-mcp").click();
	await page.getByTestId("claude-mcp-name").fill("notes");
	await page.getByTestId("claude-mcp-command").fill("notes-mcp");
	await page.getByTestId("claude-mcp-args").fill("--root\n.");
	await page.getByTestId("claude-mcp-continue").click();

	await page.getByTestId("claude-edit-scope-project").click();
	await expect(page.getByTestId("claude-edit-diff")).toContainText("notes-mcp");
	await page.getByTestId("claude-edit-apply").click();

	const mcpPath = join(workspace.worktreePath, ".mcp.json");
	await expect(async () => {
		const servers = readJson(mcpPath).mcpServers as Record<string, { command: string }>;
		expect(servers.notes?.command).toBe("notes-mcp");
	}).toPass({ timeout: 10_000 });

	const row = page.locator('[data-testid="claude-capability"][data-name="notes"]');
	await expect(row).toHaveAttribute("data-enabled", "true");

	await row.getByTestId("claude-capability-menu").click();
	await page.getByTestId("claude-capability-toggle").click();
	await page.getByTestId("claude-edit-scope-local").click();
	await expect(page.getByTestId("claude-edit-diff")).toContainText("deniedMcpServers");
	await page.getByTestId("claude-edit-apply").click();

	await expect(row).toHaveAttribute("data-enabled", "false");
	await expect(row).toContainText("local");
	expect(
		readJson(join(workspace.worktreePath, ".claude", "settings.local.json")).deniedMcpServers,
	).toEqual(["notes"]);
});

test("a skill, a hook and a plugin are each composed, then written where the scope says", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await openClaudePane(page);
	await page.getByTestId("claude-surface-capabilities").click();

	await page.getByTestId("claude-add-skill").click();
	await page.getByTestId("claude-skill-name").fill("Reviewing A Migration");
	await page
		.getByTestId("claude-skill-description")
		.fill("Use when a change moves data between schema versions.");
	await page.getByTestId("claude-skill-continue").click();
	// A skill is a directory Claude Code looks for in two places; there is no private third one.
	await expect(page.getByTestId("claude-edit-scope-local")).toHaveCount(0);
	await page.getByTestId("claude-edit-scope-project").click();
	await expect(page.getByTestId("claude-edit-diff")).toContainText("reviewing-a-migration");
	await page.getByTestId("claude-edit-apply").click();
	const skillPath = join(
		workspace.worktreePath,
		".claude",
		"skills",
		"reviewing-a-migration",
		"SKILL.md",
	);
	await expect(async () => {
		expect(readFileSync(skillPath, "utf8")).toContain("name: reviewing-a-migration");
	}).toPass({ timeout: 10_000 });

	await page.getByTestId("claude-add-hook").click();
	await page.getByTestId("claude-hook-matcher").fill("Edit|Write");
	await page.getByTestId("claude-hook-command").fill("./format.sh");
	await page.getByTestId("claude-hook-continue").click();
	await page.getByTestId("claude-edit-scope-project").click();
	await expect(page.getByTestId("claude-edit-diff")).toContainText("./format.sh");
	await page.getByTestId("claude-edit-apply").click();

	const settingsPath = join(workspace.worktreePath, ".claude", "settings.json");
	await expect(async () => {
		const hooks = readJson(settingsPath).hooks as Record<string, unknown[]>;
		expect(hooks.PreToolUse).toHaveLength(1);
	}).toPass({ timeout: 10_000 });
	// And the hook it just wrote is listed back, with the command it runs.
	const hookRow = page.locator('[data-testid="claude-capability"][data-kind="hook"]');
	await expect(hookRow).toContainText("PreToolUse");
	await expect(hookRow).toContainText("./format.sh");

	await page.getByTestId("claude-add-plugin").click();
	await page.getByTestId("claude-plugin-repo").fill("anthropics/claude-code");
	await page.getByTestId("claude-plugin-marketplace").fill("claude-code-plugins");
	await page.getByTestId("claude-plugin-name").fill("typescript-lsp");
	await page.getByTestId("claude-plugin-continue").click();
	await page.getByTestId("claude-edit-scope-project").click();
	await expect(page.getByTestId("claude-edit-diff")).toContainText("anthropics/claude-code");
	await page.getByTestId("claude-edit-apply").click();
	await expect(async () => {
		const plugins = readJson(settingsPath).enabledPlugins as Record<string, boolean>;
		expect(plugins["typescript-lsp@claude-code-plugins"]).toBe(true);
	}).toPass({ timeout: 10_000 });

	// Uninstalling runs Claude's own CLI, so the pane shows the exact argv first and runs that line —
	// here against a stand-in that records what it was asked to do.
	const log = join(E2E_DATA_DIR, "claude-uninstall.log");
	const fake = join(E2E_DATA_DIR, "fake-claude");
	writeFileSync(fake, `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\n`);
	chmodSync(fake, 0o755);
	writeFileSync(log, "");
	await requestOverWire(page, "settings.update", { config: { claudeCommand: fake } });

	const pluginRow = page.locator(
		'[data-testid="claude-capability"][data-name="typescript-lsp@claude-code-plugins"]',
	);

	// A move is install-at-target then uninstall-at-source, both shown and both logged in order.
	await pluginRow.getByTestId("claude-capability-menu").click();
	await page.getByTestId("claude-capability-move-user").click();
	await expect(page.getByTestId("claude-move-commands")).toHaveText(
		`$ ${fake} plugin install typescript-lsp@claude-code-plugins --scope user --yes\n` +
			`$ ${fake} plugin uninstall typescript-lsp@claude-code-plugins --scope project --yes`,
	);
	await page.getByTestId("claude-move-run").click();
	await expect(page.getByTestId("claude-move-dialog")).toHaveCount(0);
	await expect(async () => {
		const logged = readFileSync(log, "utf8");
		expect(logged).toContain(
			"plugin install typescript-lsp@claude-code-plugins --scope user --yes",
		);
		expect(logged).toContain(
			"plugin uninstall typescript-lsp@claude-code-plugins --scope project --yes",
		);
	}).toPass({ timeout: 10_000 });
	writeFileSync(log, "");

	await pluginRow.getByTestId("claude-capability-menu").click();
	await page.getByTestId("claude-capability-uninstall").click();
	await expect(page.getByTestId("claude-uninstall-command")).toHaveText(
		`$ ${fake} plugin uninstall typescript-lsp@claude-code-plugins --scope project --yes`,
	);

	await page.getByTestId("claude-uninstall-run").click();
	await expect(page.getByTestId("claude-uninstall-dialog")).toHaveCount(0);
	await expect(async () => {
		expect(readFileSync(log, "utf8")).toContain(
			"plugin uninstall typescript-lsp@claude-code-plugins --scope project --yes",
		);
	}).toPass({ timeout: 10_000 });
	writeFileSync(log, "");

	// A marketplace declared in settings becomes a first-class row; its actions run Claude's CLI too.
	const declared = readJson(settingsPath);
	writeFileSync(
		settingsPath,
		JSON.stringify(
			{
				...declared,
				extraKnownMarketplaces: { probe: { source: { source: "github", repo: "acme/probe" } } },
			},
			null,
			2,
		),
	);
	await page.getByTestId("claude-config-refresh").click();
	const marketRow = page.locator(
		'[data-testid="claude-capability"][data-kind="marketplace"][data-name="probe"]',
	);
	await expect(marketRow).toBeVisible();
	await expect(marketRow).toContainText("acme/probe");

	await marketRow.getByTestId("claude-capability-menu").click();
	await page.getByTestId("claude-marketplace-remove").click();
	await expect(page.getByTestId("claude-marketplace-command")).toHaveText(
		`$ ${fake} plugin marketplace remove probe --scope project`,
	);
	await page.getByTestId("claude-marketplace-run").click();
	await expect(page.getByTestId("claude-marketplace-dialog")).toHaveCount(0);
	await expect(async () => {
		expect(readFileSync(log, "utf8")).toContain("plugin marketplace remove probe --scope project");
	}).toPass({ timeout: 10_000 });

	// Adding composes source and scope, and previews before anything runs.
	await page.getByTestId("claude-add-marketplace").click();
	await page.getByTestId("claude-marketplace-source").fill("acme/other");
	await page.getByTestId("claude-marketplace-scope-project").click();
	await expect(page.getByTestId("claude-marketplace-command")).toHaveText(
		`$ ${fake} plugin marketplace add acme/other --scope project`,
	);
	await page.getByTestId("claude-marketplace-run").click();
	await expect(page.getByTestId("claude-marketplace-dialog")).toHaveCount(0);
	await expect(async () => {
		expect(readFileSync(log, "utf8")).toContain(
			"plugin marketplace add acme/other --scope project",
		);
	}).toPass({ timeout: 10_000 });
	await requestOverWire(page, "settings.update", { config: { claudeCommand: "claude" } });
});
