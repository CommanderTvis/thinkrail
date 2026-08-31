import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { bundledAgentLaunch } from "./acpPi";
import { parseSubcommand } from "./args";

describe("bundledAgentLaunch", () => {
	test("the compiled binary re-invokes itself", () => {
		expect(bundledAgentLaunch("binary")).toEqual({
			command: process.execPath,
			args: ["acp-pi"],
		});
	});

	test("from source it runs the bin entry under bun, and that entry exists", () => {
		const launch = bundledAgentLaunch("source");
		expect(launch.command).toBe(process.execPath);
		const [entry, subcommand] = launch.args;
		expect(entry).toBeDefined();
		expect(isAbsolute(entry as string)).toBe(true);
		expect(existsSync(entry as string)).toBe(true);
		expect(subcommand).toBe("acp-pi");
	});

	test("the host spawns a subcommand this bin actually dispatches", () => {
		for (const build of ["binary", "source"] as const) {
			expect(parseSubcommand(bundledAgentLaunch(build).args.slice(-1))).toBe("acp-pi");
		}
	});
});
