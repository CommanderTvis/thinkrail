import { describe, expect, it } from "bun:test";
import type { ToolRenderProps } from "@thinkrail/plugin-api/web";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SpecToolCard, specToolPaths, splitKnownPathReferences } from "./SpecToolCard";

function props(
	toolName: string,
	args: Record<string, unknown>,
	result: unknown,
): ToolRenderProps & { onOpenFile: (path: string) => void } {
	return {
		toolCallId: `${toolName}-call`,
		toolName,
		args,
		result,
		status: "done",
		workspaceRoot: "/repo",
		streaming: false,
		onOpenFile: () => {},
	};
}

function renderTool(toolName: string, args: Record<string, unknown>, result: unknown): string {
	return renderToStaticMarkup(createElement(SpecToolCard, props(toolName, args, result)));
}

describe("SpecToolCard", () => {
	it("extracts paths only from each spec tool's known structured result fields", () => {
		const cases: Array<[string, Record<string, unknown>, unknown, string[]]> = [
			[
				"spec_grep",
				{},
				{ details: { matches: [{ path: "grep/SPEC.md" }, { path: 42 }] } },
				["grep/SPEC.md"],
			],
			[
				"spec_get",
				{},
				{
					details: {
						path: "get/SPEC.md",
						links: [{ path: "forward/SPEC.md" }, { path: null }],
						reverseLinks: [{ path: "reverse/SPEC.md" }],
					},
				},
				["get/SPEC.md", "forward/SPEC.md", "reverse/SPEC.md"],
			],
			["spec_graph", {}, { details: { nodes: [{ path: "graph/SPEC.md" }] } }, ["graph/SPEC.md"]],
			[
				"spec_create",
				{ path: "create/SPEC.md" },
				{ details: { path: "create/SPEC.md" } },
				["create/SPEC.md"],
			],
			["spec_update", {}, { details: { path: "update/SPEC.md" } }, ["update/SPEC.md"]],
			["spec_delete", {}, { details: { path: "deleted/SPEC.md" } }, []],
			[
				"spec_validate",
				{},
				{
					details: {
						duplicateIds: [{ paths: ["one/SPEC.md", "two/SPEC.md"] }],
						danglingLinks: [{ fromPath: "source/SPEC.md" }],
					},
				},
				["one/SPEC.md", "two/SPEC.md", "source/SPEC.md"],
			],
		];

		for (const [toolName, args, result, expected] of cases) {
			expect(specToolPaths(toolName, args, result)).toEqual(expected);
		}
	});

	it("segments exact known path strings without letting a shorter path split a longer one", () => {
		const text = "root SPEC.md; child module-a/SPEC.md; done";
		const segments = splitKnownPathReferences(text, ["SPEC.md", "module-a/SPEC.md"]);

		expect(segments.map((segment) => segment.path).filter(Boolean)).toEqual([
			"SPEC.md",
			"module-a/SPEC.md",
		]);
		expect(segments.map((segment) => segment.text).join("")).toBe(text);
	});

	it("does not link a known path as a suffix inside another path", () => {
		const text = "foreign /tmp/SPEC.md; local SPEC.md:12; backup SPEC.md.bak; nested other/SPEC.md";
		const segments = splitKnownPathReferences(text, ["SPEC.md"]);

		expect(segments.map((segment) => segment.path).filter(Boolean)).toEqual(["SPEC.md"]);
		expect(segments.map((segment) => segment.text).join("")).toBe(text);
	});

	it("renders only structured in-worktree spec_get paths as exact preview links", () => {
		const html = renderTool(
			"spec_get",
			{ id: "sample-root" },
			{
				content: [
					{
						type: "text",
						text: [
							"sample-root [goal-and-requirements] — Sample Project",
							"path: SPEC.md",
							"links:",
							"  parent -> sample-parent (module-a/SPEC.md)",
							"  references -> foreign (/tmp/outside.md)",
						].join("\n"),
					},
				],
				details: {
					path: "SPEC.md",
					links: [{ path: "module-a/SPEC.md" }, { path: "/tmp/outside.md" }],
					reverseLinks: [],
				},
			},
		);

		expect(html).not.toContain("&quot;id&quot;");
		expect(html.match(/data-testid="tool-file-link"/g)).toHaveLength(2);
		expect(html).toContain('data-path="SPEC.md"');
		expect(html).toContain('data-path="module-a/SPEC.md"');
		expect(html).toContain("/tmp/outside.md");
		expect(html).not.toContain('data-path="/tmp/outside.md"');
	});

	it("keeps a failed spec mutation path inert", () => {
		const html = renderToStaticMarkup(
			createElement(SpecToolCard, {
				...props(
					"spec_create",
					{ path: "missing/SPEC.md", id: "missing" },
					{
						content: [{ type: "text", text: "Error: failed to create missing/SPEC.md" }],
						details: { path: "missing/SPEC.md", error: "failed" },
					},
				),
				status: "error",
			}),
		);

		expect(html).toContain("missing/SPEC.md");
		expect(html).not.toContain('data-testid="tool-file-link"');
	});

	it("keeps a successful spec_delete path inert", () => {
		const html = renderTool(
			"spec_delete",
			{ id: "removed" },
			{
				content: [{ type: "text", text: "Deleted removed/SPEC.md (id: removed)." }],
				details: { id: "removed", path: "removed/SPEC.md" },
			},
		);

		expect(html).toContain("removed/SPEC.md");
		expect(html).not.toContain('data-testid="tool-file-link"');
	});
});
