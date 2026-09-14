import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	DefaultToolRenderer,
	getToolRenderer,
	getToolSummary,
	type ToolRenderProps,
} from "../toolRegistry";
import "./register";

const INTENTIONAL_TOOLS = [
	"read",
	"write",
	"edit",
	"bash",
	"web_search",
	"fetch_content",
	"get_search_content",
	"visualize",
	"ask_user_question",
	"resolve_comment",
] as const;

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
	return renderToStaticMarkup(
		createElement(getToolRenderer(toolName), props(toolName, args, result)),
	);
}

describe("intentional bundled tool renderers", () => {
	it("registers every non-TODO tool exposed by a normal session", () => {
		for (const toolName of INTENTIONAL_TOOLS) {
			expect(getToolRenderer(toolName)).not.toBe(DefaultToolRenderer);
		}
	});

	it("leaves the five TODO tools on their plan-owned fallback receipts", () => {
		for (const toolName of ["todo_list", "todo_add", "todo_update", "todo_remove", "todo_write"]) {
			expect(getToolRenderer(toolName)).toBe(DefaultToolRenderer);
		}
	});

	it("summarizes the first query, URL, or selected stored-content target", () => {
		expect(
			getToolSummary(
				"web_search",
				props("web_search", { queries: ["first query", "second query"] }, null),
			),
		).toBe("first query");
		expect(
			getToolSummary(
				"fetch_content",
				props(
					"fetch_content",
					{ urls: ["https://example.com/one", "https://example.com/two"] },
					null,
				),
			),
		).toBe("https://example.com/one");
		expect(
			getToolSummary(
				"get_search_content",
				props(
					"get_search_content",
					{ responseId: "response-123", urlIndex: 0 },
					{
						details: { url: "https://example.com/selected" },
					},
				),
			),
		).toBe("https://example.com/selected");
	});

	it("treats only HTTP fetch targets as external links and gates local targets as files", () => {
		const result = { content: [{ type: "text", text: "Fetched." }] };
		const external = renderTool("fetch_content", { url: "https://www.example.com/docs" }, result);
		const local = renderTool("fetch_content", { url: "module-a/SPEC.md" }, result);
		const foreign = renderTool("fetch_content", { url: "/tmp/video.mp4" }, result);

		expect(external).toContain('href="https://www.example.com/docs"');
		expect(external).toContain(">example.com</a>");
		expect(local).toContain('data-path="module-a/SPEC.md"');
		expect(foreign).not.toContain('data-testid="tool-file-link"');
		expect(foreign).toContain("/tmp/video.mp4");
	});

	it("renders search and stored web content as Markdown with safe external links", () => {
		for (const [toolName, args] of [
			["web_search", { query: "preview tabs" }],
			["get_search_content", { responseId: "response-123", queryIndex: 0 }],
		] as const) {
			const html = renderTool(toolName, args, {
				content: [
					{ type: "text", text: "# Answer\n\nRead the [source](https://example.com/source)." },
				],
				details: { query: "preview tabs" },
			});
			expect(html).toContain("<h1>Answer</h1>");
			expect(html).toContain('href="https://example.com/source"');
			expect(html).not.toContain("&quot;responseId&quot;");
		}
	});
});
