import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO, E2E_PICK_FILE_POINTER } from "./fixtures/paths";

const BRIEF = "I want an app to control my lightbulbs.";

async function startBlueprint(page: Page): Promise<void> {
	await openFixtureProject(page);
	await page.getByRole("button", { name: "Draft a blueprint" }).click();
	await page.getByTestId("blueprint-brief").fill(BRIEF);
	await page.locator('[data-testid="blueprint-agent"][data-agent="pi"]').click();
	await page.getByTestId("blueprint-start-go").click();
}

const controls = (page: Page) => page.getByTestId("blueprint-control");

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
	await expect(view).toHaveAttribute("data-phase", "generating");
	await expect(page.getByTestId("blueprint-document")).not.toBeEmpty({ timeout: 60_000 });
	await expect(view).toHaveAttribute("data-phase", "idle", { timeout: 180_000 });
	await expect(controls(page).nth(2)).toBeVisible();

	for (const control of await controls(page).all()) {
		await expect(control.getByTestId("blueprint-choice")).not.toHaveAttribute("data-value", "");
	}

	const { control, option } = await chooseAlternative(page);
	await expect(view).toHaveAttribute("data-phase", "proposed", { timeout: 180_000 });
	await expect(page.getByTestId("blueprint-changes")).toBeVisible();

	const touched = page.locator(`[data-testid="blueprint-control"][data-control="${control}"]`);
	await expect(touched.getByTestId("blueprint-choice")).toHaveAttribute("data-value", option);

	// Every change in the banner is a link to its block.
	await page.locator(`[data-testid="blueprint-change"][data-control="${control}"]`).click();
	await expect(touched).toBeInViewport();

	await page.getByTestId("blueprint-accept").click();
	await expect(view).toHaveAttribute("data-phase", "idle");
	await expect(touched.getByTestId("blueprint-choice")).toHaveAttribute("data-value", option);
});

test("the Claude host is offered but reports why it cannot run here", async ({ page }) => {
	await openFixtureProject(page);
	await page.getByRole("button", { name: "Draft a blueprint" }).click();

	const claude = page.locator('[data-testid="blueprint-agent"][data-agent="claude"]');
	await expect(claude).toBeVisible();
	await expect(claude).toBeDisabled();
	await expect(claude).toHaveAttribute("title", "Turn Claude Code on in Settings.");
});

test("a takeover starts from what already exists, and only from inside the project", async ({
	page,
}) => {
	await openFixtureProject(page);
	await page.getByRole("button", { name: "Draft a blueprint" }).click();

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
