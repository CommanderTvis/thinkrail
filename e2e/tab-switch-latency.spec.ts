import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

/** Large enough that rendering it is plainly more than one frame of work. */
function bigDocument(name: string): void {
	const parts: string[] = [`# ${name}`, ""];
	for (let i = 0; i < 600; i++) {
		parts.push(`## Section ${i}`, "", `Paragraph ${i} with **bold** and some text.`, "");
		parts.push("```ts", `export const value${i} = ${i};`, "```", "");
	}
	writeFileSync(join(E2E_FIXTURE_REPO, name), parts.join("\n"));
}

test("a tab switch paints the strip before it builds the document", async ({ page }) => {
	bigDocument("latency-a.md");
	bigDocument("latency-b.md");
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tab-files").click();
	for (const name of ["latency-a.md", "latency-b.md"]) {
		const row = page.getByTestId("file-node").filter({ hasText: name });
		await expect(row).toBeVisible();
		await row.dblclick();
		await expect(page.getByTestId("editor-tab").filter({ hasText: name })).toBeVisible();
	}

	// Timed in the page, from the click event to the frame that paints each half: the driver's own
	// click overhead would otherwise swamp both numbers.
	await page.evaluate(() => {
		const marks: { strip: number[]; content: number[] } = { strip: [], content: [] };
		(window as unknown as { marks: typeof marks }).marks = marks;
		document.addEventListener(
			"click",
			(event) => {
				const tab = (event.target as HTMLElement).closest('[data-testid="editor-tab"]');
				if (!tab) return;
				const at = performance.now();
				const wanted = tab.textContent ?? "";
				const untilSelected = () => {
					if (tab.querySelector('[aria-selected="true"]')) marks.strip.push(performance.now() - at);
					else requestAnimationFrame(untilSelected);
				};
				const untilDrawn = () => {
					const heading = document.querySelector(".tr-prose-doc h1");
					if (heading && wanted.includes(heading.textContent ?? ""))
						marks.content.push(performance.now() - at);
					else requestAnimationFrame(untilDrawn);
				};
				requestAnimationFrame(untilSelected);
				requestAnimationFrame(untilDrawn);
			},
			true,
		);
	});

	const tabs = ["latency-a.md", "latency-b.md"].map((name) =>
		page.getByTestId("editor-tab").filter({ hasText: name }),
	);
	for (let round = 0; round < 3; round++) {
		for (const [index, tab] of tabs.entries()) {
			await tab.click();
			await expect(page.locator(".tr-prose-doc h1").first()).toHaveText(
				index === 0 ? "latency-a.md" : "latency-b.md",
			);
		}
	}

	const marks = await page.evaluate(
		() => (window as unknown as { marks: { strip: number[]; content: number[] } }).marks,
	);
	const worstStrip = Math.max(...marks.strip);
	const median =
		[...marks.content].sort((a, b) => a - b)[Math.floor(marks.content.length / 2)] ?? 0;
	// The strip lands within a couple of frames however long the document takes.
	expect(worstStrip).toBeLessThan(34);
	// And the document plainly takes longer, or this test is measuring a document too small to matter.
	expect(median).toBeGreaterThan(worstStrip * 2);
});
