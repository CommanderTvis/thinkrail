import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { THINKRAIL_SHIKI_THEME, THINKRAIL_SHIKI_THEME_NAME } from "@/themes";

const CANONICAL = new Set([
	"typescript",
	"tsx",
	"javascript",
	"jsx",
	"json",
	"bash",
	"python",
	"css",
	"html",
	"markdown",
	"diff",
	"yaml",
]);

const ALIAS: Record<string, string> = {
	ts: "typescript",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	sh: "bash",
	shell: "bash",
	zsh: "bash",
	md: "markdown",
	yml: "yaml",
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
function getHighlighter(): Promise<HighlighterCore> {
	highlighterPromise ??= createHighlighterCore({
		themes: [THINKRAIL_SHIKI_THEME],
		langs: [
			import("@shikijs/langs/typescript"),
			import("@shikijs/langs/tsx"),
			import("@shikijs/langs/javascript"),
			import("@shikijs/langs/jsx"),
			import("@shikijs/langs/json"),
			import("@shikijs/langs/bash"),
			import("@shikijs/langs/python"),
			import("@shikijs/langs/css"),
			import("@shikijs/langs/html"),
			import("@shikijs/langs/markdown"),
			import("@shikijs/langs/diff"),
			import("@shikijs/langs/yaml"),
		],
		engine: createJavaScriptRegexEngine(),
	});
	return highlighterPromise;
}

/**
 * Tokenizing is the expensive half, and a document is highlighted again every time it is opened — see
 * lib/SPEC.md. The theme is not part of the key: there is one, and it paints through CSS variables.
 */
const MAX_CACHED_BLOCKS = 1000;
const cache = new Map<string, string>();

function canonicalLang(lang: string): string | null {
	const key = lang.toLowerCase();
	const canonical = ALIAS[key] ?? key;
	return CANONICAL.has(canonical) ? canonical : null;
}

/** What has already been highlighted, for a first paint that does not start as plain text. */
export function cachedHighlight(code: string, lang: string): string | null {
	const canonical = canonicalLang(lang);
	return canonical === null ? null : (cache.get(`${canonical}\u0000${code}`) ?? null);
}

export async function highlightCode(code: string, lang: string): Promise<string | null> {
	const canonical = canonicalLang(lang);
	if (canonical === null) return null;
	const key = `${canonical}\u0000${code}`;
	const known = cache.get(key);
	if (known !== undefined) return known;
	try {
		const hl = await getHighlighter();
		const html = hl.codeToHtml(code, { lang: canonical, theme: THINKRAIL_SHIKI_THEME_NAME });
		if (cache.size >= MAX_CACHED_BLOCKS) {
			const oldest = cache.keys().next();
			if (!oldest.done) cache.delete(oldest.value);
		}
		cache.set(key, html);
		return html;
	} catch {
		return null;
	}
}
