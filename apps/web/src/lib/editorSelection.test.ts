import { expect, test } from "bun:test";
import { selectionQuote } from "./editorSelection";

test("a quote names the file and the lines it came from, and fences the code by language", () => {
	expect(
		selectionQuote({
			path: "src/a.ts",
			text: "const a = 1;",
			startLine: 4,
			endLine: 6,
			language: "typescript",
		}),
	).toBe("src/a.ts:4-6\n```typescript\nconst a = 1;\n```");
});

test("a single line says so once, not as a range", () => {
	expect(
		selectionQuote({
			path: "README.md",
			text: "# title",
			startLine: 1,
			endLine: 1,
			language: "markdown",
		}),
	).toBe("README.md:1\n```markdown\n# title\n```");
});
