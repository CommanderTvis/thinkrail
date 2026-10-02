import { expect, test } from "bun:test";
import { transformSync } from "oxc-transform-react";
import config from "./vite.config";

test("Vite uses the native React compiler", () => {
	expect(
		config({ command: "build", mode: "production" })
			.plugins?.flat()
			.some((plugin) => plugin && "name" in plugin && plugin.name === "vite:react-compiler"),
	).toBe(true);
});

test.each([
	["src/shell/Shell.tsx", "Shell"],
	["src/shell/layout/Workbench.tsx", "Workbench"],
	["src/chat/ChatView.tsx", "ChatView"],
	["src/chat/Composer.tsx", "Composer"],
	["src/chat/useChatScroll.ts", "useChatScroll"],
])("native compiler optimizes %s", async (path, name) => {
	const source = await Bun.file(new URL(path, import.meta.url)).text();
	const result = transformSync(path, source, { jsx: "preserve" });
	expect(result.fatal).toBe(false);
	expect(result.code).toContain('from "react/compiler-runtime"');
	expect(result.code).toMatch(
		new RegExp(`function ${name}\\([^)]*\\) \\{\\s*const \\$ = _c\\(\\d+\\);`),
	);
});
