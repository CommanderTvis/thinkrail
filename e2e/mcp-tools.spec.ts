import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openTerminal,
	runInTerminal,
	setPluginEnabled,
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

test.afterEach(async ({ page }) => {
	await setPluginEnabled(page, "claude-code", false);
});

test("a terminal's MCP address serves the spec tools, scoped to its own worktree", async ({
	page,
}) => {
	await openFixtureProject(page);
	await setPluginEnabled(page, "claude-code", true);
	const workspace = await createWorkspaceViaDialog(page);
	await openTerminal(page);
	await waitTerminalReady(page);
	const terminal = page.getByTestId("terminal-instance");
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

	// The blueprint check reads the file in this terminal's own worktree and reports what the panel
	// made of it — the feedback an author writing with ordinary file tools otherwise never gets.
	await runInTerminal(
		page,
		`printf '%s\\n' '# Thing' '' '!control scale throughput' '= One box' > BLUEPRINT.md`,
	);
	await runInTerminal(
		page,
		`${mcpCall(
			"tools/call",
			'{"name":"blueprint_check","arguments":{}}',
			'.result.content[0].text | split("\\n") | join(" / ")',
		)} > tool-answer.txt`,
	);
	await expect.poll(answer).toContain("1 control, 2 notes");
	expect(answer()).toContain('"throughput" was dropped');
	expect(answer()).toContain("has no reason after it");

	// A token nobody minted is turned away at the door, before any protocol handling.
	await runInTerminal(
		page,
		`curl -s -o /dev/null -w 'bogus token got %{http_code}' -X POST -d '{}' "\${THINKRAIL_MCP_URL%/*}/bogus"`,
	);
	await expect(terminal).toContainText("bogus token got 404");
});
