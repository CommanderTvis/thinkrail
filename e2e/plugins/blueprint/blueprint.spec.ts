import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	loadPersistedWorkspaces,
	openFixtureProject,
	requestOverWire,
} from "../../fixtures/app";
import { E2E_FIXTURE_REPO, E2E_PICK_FILE_POINTER } from "../../fixtures/paths";

const BRIEF = "I want an app to control my lightbulbs.";

/** The workspace action, not a Welcome-screen entry point — see plugin-blueprint/SPEC.md. */
async function openDraftDialog(page: Page): Promise<void> {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("workspace-draft-blueprint").click();
	await expect(page.getByTestId("blueprint-start")).toBeVisible();
}

async function startBlueprint(page: Page): Promise<void> {
	await openDraftDialog(page);
	await page.getByTestId("blueprint-brief").fill(BRIEF);
	await page.locator('[data-testid="blueprint-agent"][data-agent="pi"]').click();
	await page.getByTestId("blueprint-start-go").click();
}

const controls = (page: Page) => page.getByTestId("blueprint-control");

const EXISTING_BLUEPRINT = [
	"---",
	"id: existing-blueprint",
	"type: goal-and-requirements",
	"title: Existing Blueprint",
	"---",
	"",
	"## Goal",
	"",
	"Open with its author chat.",
].join("\n");

test("opening BLUEPRINT.md opens its author chat with the Blueprint as companion", async ({
	page,
}) => {
	const path = join(E2E_FIXTURE_REPO, "BLUEPRINT.md");
	let workspaceId: string | null = null;
	writeFileSync(path, EXISTING_BLUEPRINT);
	try {
		await openFixtureProject(page);
		await enterDefaultWorkspace(page);
		workspaceId =
			(await loadPersistedWorkspaces(page)).find((workspace) => workspace.kind === "default")?.id ??
			null;

		const blueprint = page.getByRole("button", { name: "Open Existing Blueprint. Main spec" });
		await expect(blueprint).toBeVisible();
		await blueprint.click();

		const center = page.getByTestId("center-tabs");
		await expect(center.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
		await expect(center.locator('[data-testid="editor-tab"][data-kind="file"]')).toHaveCount(0);
		await expect(page.getByTestId("chat-view")).toBeVisible();
		await expect(page.getByTestId("blueprint")).toBeVisible();
		await expect(page.getByTestId("blueprint-document")).toContainText(
			"Open with its author chat.",
		);
	} finally {
		if (workspaceId) {
			await requestOverWire(page, "plugin.blueprint.close", { workspaceId }).catch(() => {});
		}
		rmSync(path, { force: true });
	}
});

test("a catalogued terminal author with no layout tab is restored with its Blueprint", async ({
	page,
}) => {
	const path = join(E2E_FIXTURE_REPO, "BLUEPRINT.md");
	const tabKey = "blueprint-author";
	let workspaceId: string | null = null;
	writeFileSync(path, EXISTING_BLUEPRINT);
	try {
		await openFixtureProject(page);
		await enterDefaultWorkspace(page);
		workspaceId =
			(await loadPersistedWorkspaces(page)).find((workspace) => workspace.kind === "default")?.id ??
			null;
		expect(workspaceId).not.toBeNull();
		if (!workspaceId) return;
		await requestOverWire(page, "terminal.reserve", {
			workspaceId,
			tabKey,
			title: "Blueprint author",
		});
		await requestOverWire(page, "plugin.blueprint.setAuthor", {
			workspaceId,
			author: { kind: "terminal", tabKey },
		});

		await page.getByRole("button", { name: "Open Existing Blueprint. Main spec" }).click();

		const authorTab = page.getByTestId("terminal-tab").filter({ hasText: "Blueprint author" });
		await expect(
			page
				.getByTestId("center-tabs")
				.getByTestId("terminal-tab")
				.filter({ hasText: "Blueprint author" }),
		).toHaveCount(1);
		await expect(
			page
				.locator('[data-area="bottom"]')
				.getByTestId("terminal-tab")
				.filter({ hasText: "Blueprint author" }),
		).toHaveCount(0);
		await expect(authorTab).toHaveCount(1);
		await expect(page.getByTestId("blueprint")).toBeVisible();
		await expect(page.getByTestId("blueprint-document")).toContainText(
			"Open with its author chat.",
		);
	} finally {
		if (workspaceId) {
			await requestOverWire(page, "plugin.blueprint.close", { workspaceId }).catch(() => {});
			await requestOverWire(page, "terminal.close", { workspaceId, tabKey, force: true }).catch(
				() => {},
			);
		}
		rmSync(path, { force: true });
	}
});

async function chooseAlternative(page: Page): Promise<{ control: string; option: string }> {
	const target = controls(page).first();
	const control = (await target.getAttribute("data-control")) ?? "";
	const current = await target.getByTestId("blueprint-choice").getAttribute("data-value");
	await target.getByTestId("blueprint-choice").click();
	const alternative = page
		.locator(`[data-testid="blueprint-option"]:not([data-option="${current}"])`)
		.first();
	const option = (await alternative.getAttribute("data-option")) ?? "";
	await alternative.click();
	return { control, option };
}

test("a brief streams into a spec whose controls react to a change", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(300_000);
	await startBlueprint(page);

	const view = page.getByTestId("blueprint");
	await expect(page.getByTestId("blueprint-document")).not.toBeEmpty({ timeout: 60_000 });
	await expect(view).toHaveAttribute("data-phase", "ready", { timeout: 180_000 });
	await expect(controls(page).nth(2)).toBeVisible();

	for (const control of await controls(page).all()) {
		await expect(control.getByTestId("blueprint-choice")).not.toHaveAttribute("data-value", "");
	}

	const { control, option } = await chooseAlternative(page);
	await expect(page.getByTestId("blueprint-changes")).toBeVisible({ timeout: 180_000 });

	const touched = page.locator(`[data-testid="blueprint-control"][data-control="${control}"]`);
	await expect(touched.getByTestId("blueprint-choice")).toHaveAttribute("data-value", option);

	// Every change in the banner is a link to its block.
	await page.locator(`[data-testid="blueprint-change"][data-control="${control}"]`).click();
	await expect(touched).toBeInViewport();
});

test("the Claude host is offered only once its plugin is on", async ({ page }) => {
	await openDraftDialog(page);
	// The plugin is off by default, so it contributes no launcher at all — not a disabled chip; see
	// plugins/claude-code/SPEC.md.
	await expect(page.locator('[data-testid="blueprint-agent"][data-agent="claude"]')).toHaveCount(0);
});

test("a takeover starts from what already exists, and only from inside the project", async ({
	page,
}) => {
	await openDraftDialog(page);

	// An idea needs words before it can start; a project needs nothing but itself.
	await expect(page.getByTestId("blueprint-start-go")).toBeDisabled();
	await page.locator('[data-testid="blueprint-source"][data-source="product"]').click();
	await expect(page.getByTestId("blueprint-brief")).toHaveCount(0);
	await expect(page.getByTestId("blueprint-start-go")).toBeEnabled();
	await expect(page.getByTestId("blueprint-start-go")).toHaveText("Take it over");

	// A document has to be chosen, and the picker is the only way to name one.
	await page.locator('[data-testid="blueprint-source"][data-source="spec"]').click();
	await expect(page.getByTestId("blueprint-start-go")).toBeDisabled();
	await page.getByTestId("blueprint-spec-pick").click();
	await expect(page.getByTestId("blueprint-spec-path")).toContainText("outside.md");
	await expect(page.getByTestId("blueprint-start-go")).toBeEnabled();

	// The seeded pick is a file outside the project: refused before a workspace is spent on it.
	await page.getByTestId("blueprint-start-go").click();
	await expect(page.getByTestId("toast")).toContainText("Choose a document inside this project");
	await expect(page.getByTestId("blueprint-start")).toBeVisible();

	// A document in the project is accepted as far as the dialog is concerned.
	writeFileSync(E2E_PICK_FILE_POINTER, join(E2E_FIXTURE_REPO, "README.md"));
	await page.getByTestId("blueprint-spec-pick").click();
	await expect(page.getByTestId("blueprint-spec-path")).toContainText("README.md");
});
