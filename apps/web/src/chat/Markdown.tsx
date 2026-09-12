import { type ComponentProps, memo, type ReactNode, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cachedHighlight, highlightCode } from "@/lib/highlighter";
import { MermaidView } from "./tools/visualize/MermaidView";

const CHAT_PROSE =
	"tr-prose-chat max-w-none break-words [&_a]:text-primary [&_a]:underline [&_li]:my-2 [&_ol]:my-8 [&_ol]:list-decimal [&_ol]:pl-16 [&_p]:my-8 [&_table]:border-collapse [&_td]:border [&_td]:border-border-muted [&_td]:px-8 [&_td]:py-4 [&_th]:border [&_th]:border-border-muted [&_th]:px-8 [&_th]:py-4 [&_th]:text-left [&_ul]:my-8 [&_ul]:list-disc [&_ul]:pl-16";

export type MarkdownRehypePlugins = ComponentProps<typeof ReactMarkdown>["rehypePlugins"];

type MarkdownRemarkPlugins = ComponentProps<typeof ReactMarkdown>["remarkPlugins"];

const GFM_ONLY = [remarkGfm];
const withGfmCache = new WeakMap<object, MarkdownRemarkPlugins>();
function withGfm(plugins: MarkdownRemarkPlugins): MarkdownRemarkPlugins {
	if (!plugins) return GFM_ONLY;
	const known = withGfmCache.get(plugins);
	if (known) return known;
	const merged = [remarkGfm, ...plugins];
	withGfmCache.set(plugins, merged);
	return merged;
}

/**
 * Memoized: a re-render with the same document is a full re-parse otherwise, and the pane around it
 * re-renders for reasons that have nothing to do with the text. See chat/SPEC.md.
 */
export const Markdown = memo(function Markdown({
	text,
	className = CHAT_PROSE,
	remarkPlugins,
	rehypePlugins,
	urlTransform,
	components,
}: {
	text: string;
	className?: string;
	remarkPlugins?: ComponentProps<typeof ReactMarkdown>["remarkPlugins"];
	rehypePlugins?: ComponentProps<typeof ReactMarkdown>["rehypePlugins"];
	urlTransform?: ComponentProps<typeof ReactMarkdown>["urlTransform"];
	components?: ComponentProps<typeof ReactMarkdown>["components"];
}) {
	return (
		<div className={className}>
			<ReactMarkdown
				remarkPlugins={withGfm(remarkPlugins)}
				rehypePlugins={rehypePlugins}
				urlTransform={urlTransform}
				components={{ code: CodeBlock, a: Anchor, table: Table, ...components }}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
});

function Table({ children }: { children?: ReactNode }) {
	return (
		<div className="overflow-x-auto">
			<table>{children}</table>
		</div>
	);
}

function Anchor({ href, children }: { href?: string | undefined; children?: ReactNode }) {
	return (
		<a href={href} target="_blank" rel="noopener noreferrer">
			{children}
		</a>
	);
}

function CodeBlock({
	className,
	children,
}: {
	className?: string | undefined;
	children?: ReactNode;
}) {
	const lang = /language-(\w+)/.exec(className ?? "")?.[1];
	const code = String(children ?? "").replace(/\n$/, "");
	if (lang === "mermaid") return <MermaidBlock code={code} />;
	if (!lang) {
		if (!code.includes("\n")) {
			return (
				<code className="rounded-[var(--radius-xs)] bg-container-elevated-bg px-4 py-2">
					{children}
				</code>
			);
		}
		return (
			<pre className="overflow-auto rounded-[var(--radius-sm)] bg-container-elevated-bg p-8">
				{code}
			</pre>
		);
	}
	return <ShikiBlock code={code} lang={lang} />;
}

function MermaidBlock({ code }: { code: string }) {
	const [settled, setSettled] = useState<string | null>(null);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(code), 200);
		return () => clearTimeout(timer);
	}, [code]);

	const source = <ShikiBlock code={code} lang="mermaid" />;
	if (settled !== code) return source;
	return (
		<div className="whitespace-normal">
			<MermaidView source={code} fallback={source} />
		</div>
	);
}

function ShikiBlock({ code, lang }: { code: string; lang: string }) {
	// Seeded from the cache so a document opened again paints highlighted, without a plain-text frame.
	const [html, setHtml] = useState<string | null>(() => cachedHighlight(code, lang));

	useEffect(() => {
		if (cachedHighlight(code, lang) !== null) return;
		let cancelled = false;
		highlightCode(code, lang)
			.then((h) => {
				if (!cancelled) setHtml(h);
			})
			.catch(() => {
				if (!cancelled) setHtml(null);
			});
		return () => {
			cancelled = true;
		};
	}, [code, lang]);

	if (html === null) {
		return (
			<pre className="overflow-auto rounded-[var(--radius-sm)] bg-container-elevated-bg p-8 text-text-default">
				{code}
			</pre>
		);
	}
	return (
		<div
			className="overflow-auto rounded-[var(--radius-sm)] [&_pre]:!m-0 [&_pre]:!bg-container-elevated-bg [&_pre]:p-8"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is escaped, themed markup
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
