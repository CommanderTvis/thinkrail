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
	await expect(terminal).toContainText('Rendered "Wired graph" in ThinkRail (revision 1)');
	const pane = page.getByTestId("visualization-pane");
	await expect(pane).toBeVisible();
	await expect(pane.getByTestId("mermaid-svg").locator("svg").first()).toBeVisible({
		timeout: 20_000,
	});

	// Calling again updates the same view in place — the live half of the contract.
	await runInTerminal(
		page,
		mcpCall(
			"tools/call",
			'{"name":"visualize","arguments":{"type":"comparison","title":"Wired graph","options":[{"name":"OptA","recommended":true}]}}',
			".result.content[0].text",
		),
	);
	await expect(terminal).toContainText("revision 2");
	await expect(pane).toContainText("OptA");

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
