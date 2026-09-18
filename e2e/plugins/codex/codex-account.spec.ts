import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	requestOverWire,
	setPluginEnabled,
} from "../../fixtures/app";
import { E2E_DATA_DIR } from "../../fixtures/paths";

test("Codex account refresh reuses its server and reports used allowances and errors", async ({
	page,
}, testInfo) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const executable = join(E2E_DATA_DIR, "codex-account-fixture");
	const control = join(E2E_DATA_DIR, "codex-account-control.json");
	const pidFile = join(E2E_DATA_DIR, "codex-account-pid");
	const setAccount = (account: unknown, used = 25, error = false) =>
		writeFileSync(control, JSON.stringify({ account, used, error }));
	const identity = { type: "chatgpt", email: "codex@example.test", planType: "pro" };
	setAccount(identity);
	writeFileSync(
		executable,
		`#!${process.execPath}
const { readFileSync, writeFileSync } = require("node:fs");
const { createInterface } = require("node:readline");
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
let initialized = false;
createInterface({ input: process.stdin }).on("line", (line) => {
 const request = JSON.parse(line);
 const config = JSON.parse(readFileSync(${JSON.stringify(control)}, "utf8"));
 if (request.method === "initialized") { initialized = true; return; }
 if (request.method !== "initialize" && !initialized) process.exit(2);
 const result = request.method === "initialize" ? {} : request.method === "account/read" ? { account: config.account, requiresOpenaiAuth: true } : { rateLimits: {
  limitId: "codex", limitName: "Codex", primary: { usedPercent: config.used, windowDurationMins: 300, resetsAt: 1800000000 },
  secondary: { usedPercent: 80, windowDurationMins: 10080, resetsAt: null }
 } };
 const response = config.error && request.method === "account/rateLimits/read" ? { error: { code: -1, message: "Usage temporarily unavailable" } } : { result };
 process.stdout.write(JSON.stringify({ id: request.id, ...response }) + "\\n");
});
`,
		{ mode: 0o755 },
	);
	try {
		await requestOverWire(page, "settings.update", {
			config: { plugins: { codex: { command: executable } } },
		});
		await setPluginEnabled(page, "codex", true);
		const tab = page.getByTestId("tab-plugin:codex:config");
		if ((await tab.count()) === 0) {
			await page.getByTestId("side-group-menu").first().click();
			await page.getByTestId("show-tool-plugin:codex:config").click();
		}
		await tab.first().click();
		await page.getByTestId("codex-surface-account").click();
		const account = page.getByTestId("codex-account");
		await expect(account).toContainText("codex@example.test");
		await expect(account).toContainText("pro");
		const windows = page.getByTestId("codex-usage-window");
		await expect(windows).toHaveCount(2);
		await expect(account.getByText("Email", { exact: true })).toBeVisible();
		await expect(account.getByText("Plan", { exact: true })).toBeVisible();
		await expect(windows.first()).toContainText("25% used");
		await expect(windows.first().getByRole("progressbar")).toHaveAttribute("value", "25");
		await expect(windows.first()).toContainText("5 hr");
		await expect(windows.first()).toContainText("Resets");
		await expect(windows.last()).toContainText("80% used");
		await page
			.getByTestId("codex-config")
			.screenshot({ path: testInfo.outputPath("codex-account.png") });
		const pid = readFileSync(pidFile, "utf8");
		setAccount(identity, 40);
		await page.getByRole("button", { name: "Refresh account and usage" }).click();
		await expect(windows.first()).toContainText("40% used");
		await expect(windows.first().getByRole("progressbar")).toHaveAttribute("value", "40");
		expect(readFileSync(pidFile, "utf8")).toBe(pid);
		setAccount(identity, 40, true);
		await page.getByTestId("codex-config-refresh").click();
		await expect(page.getByTestId("codex-usage-error")).toContainText(
			"Usage temporarily unavailable",
		);
		await expect(account).toContainText("codex@example.test");
		await expect(windows).toHaveCount(0);
		setAccount({ type: "apiKey" });
		await page.getByTestId("codex-config-refresh").click();
		await expect(page.getByTestId("codex-usage-empty")).toContainText("ChatGPT accounts");
		setAccount(null);
		await page.getByTestId("codex-config-refresh").click();
		await expect(page.getByTestId("codex-account-signed-out")).toContainText("codex login");
		await requestOverWire(page, "settings.update", {
			config: { plugins: { codex: { command: `${executable} --model changed` } } },
		});
		setAccount(identity);
		await page.getByTestId("codex-config-refresh").click();
		await expect(account).toContainText("codex@example.test");
		const replacementPid = readFileSync(pidFile, "utf8");
		expect(replacementPid).not.toBe(pid);
		expect(() => process.kill(Number(pid), 0)).toThrow();
		await setPluginEnabled(page, "codex", false);
		await expect
			.poll(() => {
				try {
					process.kill(Number(replacementPid), 0);
					return true;
				} catch {
					return false;
				}
			})
			.toBe(false);
	} finally {
		await setPluginEnabled(page, "codex", false);
		await requestOverWire(page, "settings.update", {
			config: { plugins: { codex: { command: "codex" } } },
		});
	}
});
