import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openTerminal,
	runInTerminal,
	setPluginEnabled,
} from "../../fixtures/app";

test("Codex context shows file provenance and opens the project instructions", async ({
	page,
}, testInfo) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await setPluginEnabled(page, "codex", true);
	try {
		const tab = page.getByTestId("tab-plugin:codex:config");
		if ((await tab.count()) === 0) {
			await page.getByTestId("side-group-menu").first().click();
			await page.getByTestId("show-tool-plugin:codex:config").click();
		}
		await tab.first().click();
		await page.getByTestId("codex-offer-project").click();
		const editorTab = page.getByTestId("editor-tab").filter({ hasText: "AGENTS.md" });
		await editorTab.getByTestId("editor-tab-close").click();
		await tab.first().click();
		const row = page.getByTestId("codex-instructions");
		await expect(row).toHaveCount(1);
		await expect(row.locator('[data-scope="project"]')).toHaveText("project");
		await expect(row.getByText("AGENTS.md", { exact: true })).toBeVisible();
		const source = row.getByRole("button");
		await expect(source).toHaveAttribute("title", /\/AGENTS\.md$/);
		await expect(source).toHaveText((await source.getAttribute("title")) ?? "");
		const size = await row.locator("span").last().innerText();
		await expect(page.getByTestId("codex-context-total")).toHaveText(`Persistent context${size}`);
		await page
			.getByTestId("codex-config")
			.screenshot({ path: testInfo.outputPath("codex-context.png") });
		await source.click();
		await expect(editorTab).toHaveAttribute("data-active", "true");
	} finally {
		await setPluginEnabled(page, "codex", false);
	}
});

test("Codex context follows the visible tab CWD and preserves it across hooks", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const nested = join(workspace.worktreePath, "nested");
	mkdirSync(nested);
	writeFileSync(join(workspace.worktreePath, "AGENTS.md"), "Root instructions");
	writeFileSync(join(nested, "AGENTS.md"), "Nested instructions");
	await setPluginEnabled(page, "codex", true);
	try {
		await page.getByTestId("side-group-menu").first().click();
		await page.getByTestId("show-tool-plugin:codex:config").click();
		const scope = page.getByTestId("codex-config-scope");
		await expect(scope).toHaveAttribute("data-scope", "workspace");
		await expect(scope).toContainText("No Codex in tab");
		await expect(scope).toContainText("Showing what a new session here would load");
		await expect(page.getByTestId("codex-config-scope-cwd")).toHaveCount(0);
		await expect(page.getByTestId("codex-instructions")).toHaveCount(1);
		await openTerminal(page);
		await expect(scope).toContainText("No Codex in tab");
		const payload = JSON.stringify({
			hook_event_name: "SessionStart",
			session_id: "cwd-test",
			cwd: nested,
		});
		await runInTerminal(
			page,
			`curl -s -o /dev/null -H 'Content-Type: application/json' -d '${payload}' "$THINKRAIL_CODEX_STATUS_URL"`,
		);
		await expect(scope).toHaveAttribute("data-scope", "session");
		await expect(scope).toContainText("Context of Codex in tab");
		await expect(scope.locator(".tr-text-emphasis")).not.toBeEmpty();
		await expect(page.getByTestId("codex-config-scope-cwd")).toHaveAttribute("title", nested);
		await expect(page.getByTestId("codex-instructions")).toHaveCount(2);
		await runInTerminal(
			page,
			`curl -s -o /dev/null -H 'Content-Type: application/json' -d '{"hook_event_name":"Stop"}' "$THINKRAIL_CODEX_STATUS_URL"`,
		);
		await page.getByTestId("codex-config-refresh").click();
		await expect(page.getByTestId("codex-instructions")).toHaveCount(2);
		await openTerminal(page);
		await expect(scope).toHaveAttribute("data-scope", "workspace");
		await expect(page.getByTestId("codex-instructions")).toHaveCount(1);
		await page
			.getByTestId("terminal-tab")
			.filter({ has: page.getByTestId("terminal-codex-status") })
			.click();
		await expect(scope).toHaveAttribute("data-scope", "session");
		await expect(page.getByTestId("codex-instructions")).toHaveCount(2);
		await page
			.getByTestId("codex-instructions")
			.filter({ hasText: nested })
			.getByRole("button")
			.click();
		await expect(page.getByTestId("editor-tab").filter({ hasText: "AGENTS.md" })).toHaveAttribute(
			"data-active",
			"true",
		);
	} finally {
		await setPluginEnabled(page, "codex", false);
	}
});
