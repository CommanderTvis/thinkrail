import { describe, expect, it } from "bun:test";
import { mcpListCapabilities, parseMcpList } from "./mcpList";

const OUTPUT = [
	"Checking MCP server health…",
	"",
	"claude.ai Uber Eats: https://mcp.ubereats.com/eats-claude/mcp - ⊘ Disabled for this project (re-enable via /mcp)",
	"claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✔ Connected",
	"plugin:cloudflare:cloudflare: https://mcp.cloudflare.com/mcp (HTTP) - ! Needs authentication",
	"plugin:thinkrail:thinkrail: http://127.0.0.1:1/mcp (HTTP) - ✘ Failed to connect — Missing environment variables: THINKRAIL_MCP_URL",
	"notes: notes-mcp - ✔ Connected",
].join("\n");

describe("parseMcpList", () => {
	it("reads a name with spaces, a target with a dash-free URL, and the status after the last dash", () => {
		const entries = parseMcpList(OUTPUT);
		expect(entries.map((entry) => entry.name)).toEqual([
			"claude.ai Uber Eats",
			"claude.ai Google Drive",
			"plugin:cloudflare:cloudflare",
			"plugin:thinkrail:thinkrail",
			"notes",
		]);
		expect(entries[0]).toMatchObject({
			target: "https://mcp.ubereats.com/eats-claude/mcp",
			status: "disabled",
		});
		expect(entries[1]?.status).toBe("connected");
		expect(entries[2]?.status).toBe("needs-auth");
		expect(entries[3]).toMatchObject({
			status: "failed",
			statusText: "✘ Failed to connect — Missing environment variables: THINKRAIL_MCP_URL",
		});
	});

	it("skips the banner and blank lines, and an unknown glyph is still a row", () => {
		expect(parseMcpList("Checking MCP server health…\n\n")).toEqual([]);
		expect(parseMcpList("x: y - ? odd").at(0)?.status).toBe("unknown");
	});
});

describe("mcpListCapabilities", () => {
	it("keeps only what no file declares, and names the /mcp list that disabled a server", () => {
		const rows = mcpListCapabilities(parseMcpList(OUTPUT), new Set(["notes"]), "/w");
		expect(rows.map((row) => row.name)).not.toContain("notes");
		const eats = rows.find((row) => row.name === "claude.ai Uber Eats");
		expect(eats).toMatchObject({
			enabled: false,
			origin: { scope: "user", path: null },
			disabledBy: { scope: "local", keyPath: ["projects", "/w", "disabledMcpServers"] },
		});
		expect(rows.find((row) => row.name === "claude.ai Google Drive")?.enabled).toBe(true);
	});
});
