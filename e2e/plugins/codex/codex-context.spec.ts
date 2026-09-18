import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, setPluginEnabled } from "../../fixtures/app";

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
