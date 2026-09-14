import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openTerminal,
	openWorkspaceChat,
	runInTerminal,
	setPluginEnabled,
	waitTerminalReady,
} from "../../fixtures/app";

/**
 * What the Claude Code plugin's .mcp.json does: dial $THINKRAIL_MCP_URL from inside the terminal.
 * Driving it with curl from the terminal itself proves the env stamping, the token identity, and the
 * protocol — not just the endpoint.
 */
function mcpCall(method: string, params: string, extract: string): string {
	const body = `{"jsonrpc":"2.0","id":1,"method":"${method}","params":${params}}`;
	return `curl -s -X POST -H 'Content-Type: application/json' -d '${body}' "$THINKRAIL_MCP_URL" | jq -r '${extract}'`;
}

test.afterEach(async ({ page }) => {
	await setPluginEnabled(page, "claude-code", false);
});

test("the visualize MCP tool draws a live view beside the terminal that called it", async ({
	page,
}) => {
	await openFixtureProject(page);
	await setPluginEnabled(page, "claude-code", true);
	const workspace = await createWorkspaceViaDialog(page);
	await openTerminal(page);
	await waitTerminalReady(page);
	// Beside a 45% companion the terminal is too narrow for a long command echo plus its answer to stay
	// within xterm's visible rows — the only rows in the DOM — so once the pane is open, a tool's
	// answer is read from a file it is sent to instead of from the screen.
	const answer = () => {
		try {
			return readFileSync(join(workspace.worktreePath, "tool-answer.txt"), "utf8");
		} catch {
			return "";
		}
	};

	// The visualize tool draws a live view in the workbench, keyed to this very terminal.
	await runInTerminal(
		page,
		mcpCall(
			"tools/call",
			'{"name":"visualize","arguments":{"type":"diagram","title":"Wired graph","mermaid":"graph TD;A-->B;"}}',
			".result.content[0].text",
		),
	);
	// Not a tab: the drawing is an embedded pane inside the terminal's own body. (The tool's own
	// "Rendered …" reply lands in the shell, but the split just resized xterm and rewrapped it —
	// the pane itself is the assertion that matters.)
	const pane = page.getByTestId("embedded-pane");
	await expect(pane).toBeVisible();
	// A companion opens at its intended share of the host, not at the minimum sliver the group mounted
	// with when there was nothing to show.
	await expect
		.poll(async () => {
			const box = await pane.boundingBox();
			const host = await page.getByTestId("terminal-instance").first().boundingBox();
			return box && host ? box.width / (box.width + host.width) : 0;
		})
		.toBeGreaterThan(0.4);
	// The pane must not have cost the terminal its life: same tabs, same PTY.
	await expect(page.getByTestId("terminal-tab")).toHaveCount(2);
	await expect(page.getByTestId("embedded-pane-title")).toHaveText("Wired graph");
	await expect(pane.getByTestId("mermaid-svg").locator("svg").first()).toBeVisible({
		timeout: 20_000,
	});
	// The diagram is navigable in place — the PDF preview's gesture vocabulary, not a static picture.
	await expect(pane.getByTestId("mermaid-pan-zoom")).toBeVisible();
	await expect(pane.getByTestId("mermaid-zoom-level")).toHaveText("100%");
	await pane.getByTestId("mermaid-zoom-in").click();
	await expect(pane.getByTestId("mermaid-zoom-level")).not.toHaveText("100%");
	await pane.getByTestId("mermaid-zoom-reset").click();
	await expect(pane.getByTestId("mermaid-zoom-level")).toHaveText("100%");

	// Calling again updates the same view in place — the live half of the contract.
	await runInTerminal(
		page,
		mcpCall(
			"tools/call",
			'{"name":"visualize","arguments":{"type":"comparison","title":"Wired graph","options":[{"name":"OptA","recommended":true}]}}',
			".result.content[0].text",
		),
	);
	await expect(pane).toContainText("OptA");
	await expect(page.getByTestId("terminal-tab")).toHaveCount(2);

	// Closing folds it back into a chip on the terminal; the chip reopens it.
	await page.getByTestId("embedded-pane-close").click();
	await expect(page.getByTestId("embedded-pane")).toHaveCount(0);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(2);
	const chip = page.getByTestId("terminal-embedded-chip");
	await expect(chip).toHaveAttribute("data-kind", "visualization");
	await chip.click();
	await expect(page.getByTestId("embedded-pane")).toBeVisible();

	// A diagram the renderer refuses comes back to the agent as a tool error, not a red card it
	// never sees — the verdict is the browser's, reported back over the wire.
	await runInTerminal(
		page,
		`${mcpCall(
			"tools/call",
			'{"name":"visualize","arguments":{"type":"diagram","title":"Broken","mermaid":"graph TD;A--"}}',
			".result.content[0].text",
		)} > tool-answer.txt`,
	);
	await expect.poll(answer).toContain("The diagram did not render");
	expect(answer()).toContain("call visualize again");
	// And the pane keeps the last drawing that worked, rather than the typo that replaced it.
	await expect(page.getByTestId("embedded-pane-title")).toHaveText("Wired graph");

	// A resumed conversation reclaims its drawing in whatever terminal it lands in: this terminal
	// reports the session that drew, and the pane comes back with it.
	await runInTerminal(
		page,
		`curl -s -o /dev/null -d '{"v":1,"agent":"claude","session_id":"s-viz","event":"session_start"}' "$THINKRAIL_AGENT_STATUS_URL"`,
	);
	await openTerminal(page);
	await waitTerminalReady(page);
	await expect(page.getByTestId("embedded-pane")).toHaveCount(0);
	await runInTerminal(
		page,
		`curl -s -o /dev/null -d '{"v":1,"agent":"claude","session_id":"s-viz","event":"session_start"}' "$THINKRAIL_AGENT_STATUS_URL"`,
	);
	await expect(page.getByTestId("embedded-pane")).toBeVisible();
	await expect(page.getByTestId("embedded-pane-title")).toHaveText("Wired graph");
});

async function openChatAndSend(page: Page, prompt: string): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

async function awaitExpandedCard(page: Page, tool: string): Promise<Locator> {
	const card = page.locator(`[data-testid="tool-card"][data-tool="${tool}"]`).first();
	await expect(card).toBeVisible({ timeout: 90_000 });
	await expect(card).toHaveAttribute("data-expanded", "true", { timeout: 90_000 });
	return card;
}

test("visualize (diagram) renders mermaid as an SVG", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(150_000);
	await openChatAndSend(
		page,
		"Use the visualize tool with type='diagram' and this exact mermaid source: `flowchart TD; User --> Server --> Database`. Use only that tool.",
	);
	const card = await awaitExpandedCard(page, "visualize");
	await expect(card.getByTestId("tool-visualize")).toBeVisible();
	await expect(card.getByTestId("tool-visualize-diagram")).toBeVisible();
	await expect(card.getByTestId("mermaid-svg").locator("svg").first()).toBeVisible({
		timeout: 30_000,
	});

	await card.getByTestId("mermaid-fullscreen").first().click();
	const dialog = page.getByTestId("mermaid-fullscreen-dialog");
	await expect(dialog).toBeVisible();
	const fsSvg = dialog.locator("svg").first();
	await expect(fsSvg).toBeVisible();
	const viewport = dialog.getByTestId("mermaid-fullscreen-svg");

	const widthBefore = (await fsSvg.boundingBox())?.width ?? 0;
	for (let i = 0; i < 4; i++) await dialog.getByTestId("mermaid-zoom-in").click();
	await expect(dialog.getByTestId("mermaid-zoom-level")).not.toHaveText("100%");
	await expect
		.poll(async () => (await fsSvg.boundingBox())?.width ?? 0)
		.toBeGreaterThan(widthBefore * 1.5);

	await expect
		.poll(() => viewport.evaluate((el) => el.scrollWidth - el.clientWidth))
		.toBeGreaterThan(0);
	const box = await viewport.boundingBox();
	if (!box) throw new Error("no fullscreen viewport box");
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	await page.mouse.move(cx, cy);
	await page.mouse.down();
	await page.mouse.move(cx - 140, cy - 90, { steps: 10 });
	await page.mouse.up();
	await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("visualize (comparison) renders option cards with a recommended pick", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openChatAndSend(
		page,
		"Use the visualize tool with type='comparison' to compare REST and GraphQL — give each two pros and one con, and mark exactly one option as recommended. Use only that tool.",
	);
	const card = await awaitExpandedCard(page, "visualize");
	const body = card.getByTestId("tool-visualize-comparison");
	await expect(body).toBeVisible();
	await expect(body).toContainText("REST");
	await expect(body).toContainText("GraphQL");
	await expect(body.locator('[data-recommended="true"]').first()).toBeVisible();
});
