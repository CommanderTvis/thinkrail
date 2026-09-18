import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	requestOverWire,
	setPluginEnabled,
} from "../../fixtures/app";
import { E2E_DATA_DIR } from "../../fixtures/paths";

async function recordLaunches(page: Page) {
	const log = join(E2E_DATA_DIR, "codex-launch-args.json");
	const executable = join(E2E_DATA_DIR, "codex-launch-fixture");
	writeFileSync(log, "[]");
	writeFileSync(
		executable,
		`#!${process.execPath}
if (process.argv.slice(2).join(" ") === "app-server") {
 require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialized") return;
  const result = request.method === "model/list" ? { data: [
   { model: "gpt-6-astra", displayName: "GPT-6 Astra" },
   { model: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
   { model: "gpt-5.6-terra", displayName: "GPT-5.6 Terra" },
   { model: "gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
  ] } : {};
  process.stdout.write(JSON.stringify({ id: request.id, result }) + "\\n");
 });
} else require("node:fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));
`,
		{ mode: 0o755 },
	);
	await requestOverWire(page, "settings.update", {
		config: { plugins: { codex: { command: executable } } },
	});
	await setPluginEnabled(page, "codex", true);
	return () => JSON.parse(readFileSync(log, "utf8"));
}

async function restoreCodex(page: Page) {
	await requestOverWire(page, "settings.update", {
		config: {
			plugins: {
				codex: { enabled: false, command: "codex", ideContext: false, permissionMode: "default" },
			},
		},
	});
}

test("Codex's launcher preserves the default and offers per-run models like Claude Code", async ({
	page,
}, testInfo) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const launcher = page.getByTestId("new-codex");
	await expect(launcher).toHaveCount(0);
	const args = await recordLaunches(page);
	try {
		const terminals = page.getByTestId("terminal-tab");
		const before = await terminals.count();
		await launcher.click();
		await expect(terminals).toHaveCount(before + 1);
		await expect.poll(args).toEqual(["-c", expect.stringContaining("mcp_servers.thinkrail.url=")]);
		await launcher.click({ button: "right" });
		const menu = page.getByTestId("codex-launch-menu");
		await expect(menu).toBeVisible();
		await expect(page.getByTestId("codex-launch-model-gpt-6-astra")).toHaveText("GPT-6 Astra");
		await expect(page.getByTestId("codex-launch-model-gpt-5.6-sol")).toHaveText("GPT-5.6 Sol");
		await expect(page.getByTestId("codex-launch-model-gpt-5.6-terra")).toHaveText("GPT-5.6 Terra");
		await expect(page.getByTestId("codex-launch-model-gpt-5.6-luna")).toHaveText("GPT-5.6 Luna");
		await menu.screenshot({ path: testInfo.outputPath("codex-launch-models.png") });
		await page.getByTestId("codex-launch-model-gpt-6-astra").click();
		await expect(menu).toBeHidden();
		await expect(terminals).toHaveCount(before + 2);
		await expect
			.poll(args)
			.toEqual([
				"-c",
				expect.stringContaining("mcp_servers.thinkrail.url="),
				"--model",
				"gpt-6-astra",
			]);
	} finally {
		await restoreCodex(page);
	}
});

for (const selection of ["explicit", "default", "switch-agent"] as const) {
	test(`Start work launches Codex with the ${selection} model choice`, async ({
		page,
	}, testInfo) => {
		await openFixtureProject(page);
		const args = await recordLaunches(page);
		try {
			await requestOverWire(page, "settings.update", {
				config: { plugins: { codex: { permissionMode: "full-auto" } } },
			});
			await setPluginEnabled(page, "claude-code", true);
			await page.getByTestId("add-workspace").first().click();
			const dialog = page.getByTestId("new-workspace-dialog");
			await dialog.getByTestId("ws-target-default").click();
			await dialog.locator('[data-testid="ws-agent"][data-agent="claude"]').click();
			await dialog.getByTestId("ws-claude-model").click();
			await page.getByTestId("ws-claude-model-opus").click();
			await dialog.locator('[data-testid="ws-agent"][data-agent="codex"]').click();
			const picker = dialog.getByTestId("ws-codex-model");
			await expect(picker).toHaveText("Default model");
			if (selection !== "switch-agent") {
				await picker.click();
				await page.getByTestId("ws-codex-model-gpt-5.6-sol").click();
				await expect(picker).toHaveText("GPT-5.6 Sol");
				if (selection === "default") {
					await picker.click();
					await page.getByRole("menuitem", { name: "Default model", exact: true }).click();
					await expect(picker).toHaveText("Default model");
				}
			}
			await dialog.getByTestId("ws-prompt").fill("probe the build");
			if (selection === "explicit") {
				await dialog.screenshot({ path: testInfo.outputPath("codex-start-work-model.png") });
			}
			await page.getByTestId("create-workspace").click();
			await expect(dialog).toBeHidden();
			await expect(page.getByTestId("center-group").getByTestId("terminal-tab")).toHaveCount(1);
			await expect
				.poll(args)
				.toEqual([
					"-c",
					expect.stringContaining("mcp_servers.thinkrail.url="),
					...(selection === "explicit" ? ["--model", "gpt-5.6-sol"] : []),
					"--sandbox",
					"workspace-write",
					"--ask-for-approval",
					"on-request",
					"probe the build",
				]);
		} finally {
			await restoreCodex(page);
			await setPluginEnabled(page, "claude-code", false);
		}
	});
}

test("Codex settings persist default permissions and menu permissions override them", async ({
	page,
}, testInfo) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const args = await recordLaunches(page);
	try {
		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-codex").click();
		const ideContext = page.getByTestId("codex-ide-context-toggle");
		await expect(ideContext).toHaveAttribute("aria-pressed", "false");
		await ideContext.click();
		await expect(ideContext).toHaveAttribute("aria-pressed", "true");
		const picker = page.getByTestId("codex-permission-mode");
		await expect(picker).toHaveText("Use Codex configuration");
		await page
			.getByTestId("settings-codex")
			.screenshot({ path: testInfo.outputPath("codex-permissions-default.png") });
		await picker.click();
		await expect(page.getByRole("menuitemradio", { checked: true })).toHaveText(
			"Use Codex configuration",
		);
		const menu = page.getByRole("menu");
		const triggerBounds = await picker.boundingBox();
		const menuBounds = await menu.boundingBox();
		expect(triggerBounds).not.toBeNull();
		expect(menuBounds).not.toBeNull();
		expect(menuBounds?.x).toBeCloseTo(triggerBounds?.x ?? 0, 0);
		expect(menuBounds?.width).toBeCloseTo(triggerBounds?.width ?? 0, 0);
		await page.screenshot({ path: testInfo.outputPath("codex-permissions-menu.png") });
		await page.getByTestId("codex-permission-mode-sandbox-danger-full-access").click();
		await expect(picker).toHaveText("Sandbox: danger-full-access");
		await page.reload();
		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-codex").click();
		await expect(ideContext).toHaveAttribute("aria-pressed", "true");
		await expect(picker).toHaveText("Sandbox: danger-full-access");
		await page
			.getByTestId("settings-codex")
			.screenshot({ path: testInfo.outputPath("codex-permissions-saved.png") });
		await picker.click();
		await expect(page.getByRole("menuitemradio", { checked: true })).toHaveText(
			"Sandbox: danger-full-access",
		);
		await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");
		const launcher = page.getByTestId("new-codex");
		await launcher.click();
		await expect
			.poll(args)
			.toEqual([
				"-c",
				expect.stringContaining("mcp_servers.thinkrail.url="),
				"-s",
				"danger-full-access",
			]);
		await launcher.click({ button: "right" });
		await page.getByTestId("codex-launch-sandbox-read-only").click();
		await expect
			.poll(args)
			.toEqual(["-c", expect.stringContaining("mcp_servers.thinkrail.url="), "-s", "read-only"]);
	} finally {
		await restoreCodex(page);
	}
});
