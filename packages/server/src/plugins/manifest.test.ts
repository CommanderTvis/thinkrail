import { expect, test } from "bun:test";
import { PLUGIN_API_GENERATION } from "@thinkrail/plugin-api";
import { validateManifest } from "./manifest";

function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "spec-dialect",
		label: "Spec Dialect",
		icon: "book-open",
		version: "0.0.0",
		apiGeneration: PLUGIN_API_GENERATION,
		wireVersion: 1,
		enabledByDefault: true,
		dependsOn: [],
		contributes: { sideTools: [], fileViewers: [] },
		...overrides,
	};
}

test("accepts a well-formed builtin manifest", () => {
	const result = validateManifest(baseManifest(), "builtin");
	expect("manifest" in result).toBe(true);
});

test("a side tool may declare requiresGit, and only as true", () => {
	const sideTool = (requiresGit: unknown) =>
		baseManifest({
			contributes: {
				sideTools: [
					{ tool: "graph", label: "Graph", icon: "git-branch", defaultSide: "right", requiresGit },
				],
				fileViewers: [],
			},
		});
	expect("manifest" in validateManifest(sideTool(true), "builtin")).toBe(true);
	expect("refused" in validateManifest(sideTool(false), "builtin")).toBe(true);
});

test("refuses a manifest that fails the wire shape", () => {
	const result = validateManifest({ id: "spec-dialect" }, "external", "spec-dialect");
	expect("refused" in result).toBe(true);
});

test("refuses an external plugin whose id does not match its directory", () => {
	const result = validateManifest(baseManifest(), "external", "some-other-dir");
	expect(result).toEqual({
		refused: 'plugin id "spec-dialect" does not match its directory "some-other-dir"',
	});
});

test("refuses a generation mismatch, naming the plugin, its declared generation and the host's", () => {
	const result = validateManifest(baseManifest({ apiGeneration: 99 }), "builtin");
	expect(result).toEqual({
		refused: `plugin spec-dialect declares apiGeneration 99, host expects ${PLUGIN_API_GENERATION}`,
	});
});
