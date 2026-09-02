import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openTerminal,
	runInTerminal,
	waitTerminalReady,
} from "./fixtures/app";

/**
 * What the Claude Code plugin's .mcp.json does: dial $THINKRAIL_MCP_URL from inside the terminal.
 * Driving it with curl from the terminal itself proves the env stamping, the token identity, and the
 * protocol — not just the endpoint.
 */
function mcpCall(method: string, params: string, extract: string): string {
	const body = `{"jsonrpc":"2.0","id":1,"method":"${method}","params":${params}}`;
	return `curl -s -X POST -H 'Content-Type: application/json' -d '${body}' "$THINKRAIL_MCP_URL" | jq -r '${extract}'`;
}

test("a terminal's MCP address serves the spec tools, scoped to its own worktree", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await openTerminal(page);
	await waitTerminalReady(page);
	const terminal = page.getByTestId("terminal-instance");

	await runInTerminal(
		page,
		mcpCall(
			"initialize",
			'{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"e2e","version":"0"}}',
			'.result.serverInfo.name + " speaks " + .result.protocolVersion',
		),
	);
	await expect(terminal).toContainText("thinkrail speaks 2025-06-18");

	await runInTerminal(
		page,
		mcpCall("tools/list", "{}", '.result.tools | length | tostring + " tools listed"'),
	);
	await expect(terminal).toContainText("9 tools listed");

	await runInTerminal(
		page,
		mcpCall(
			"tools/call",
			'{"name":"spec_create","arguments":{"path":"docs/mcp-wired/SPEC.md","id":"wired-spec","type":"task-spec","title":"Wired"}}',
			".result.content[0].text",
		),
	);
	await expect(terminal).toContainText("Created docs/mcp-wired/SPEC.md (id: wired-spec)");

	await runInTerminal(
		page,
		mcpCall(
			"tools/call",
			'{"name":"spec_get","arguments":{"id":"wired-spec"}}',
			".result.content[0].text",
		),
	);
	await expect(terminal).toContainText("wired-spec [task-spec]");

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

	// The blueprint check reads the file in this terminal's own worktree and reports what the panel
	// made of it — the feedback an author writing with ordinary file tools otherwise never gets.
	await runInTerminal(
		page,
		`printf '%s\\n' '# Thing' '' '!control scale throughput' '= One box' > BLUEPRINT.md`,
	);
	await runInTerminal(
		page,
		mcpCall(
			"tools/call",
			'{"name":"blueprint_check","arguments":{}}',
			'.result.content[0].text | split("\\n") | join(" / ")',
		),
	);
	await expect(terminal).toContainText("1 control, 2 notes");
	await expect(terminal).toContainText('"throughput" was dropped');
	await expect(terminal).toContainText("has no reason after it");

	// A token nobody minted is turned away at the door, before any protocol handling.
	await runInTerminal(
		page,
		`curl -s -o /dev/null -w 'bogus token got %{http_code}' -X POST -d '{}' "\${THINKRAIL_MCP_URL%/*}/bogus"`,
	);
	await expect(terminal).toContainText("bogus token got 404");
});
