import { remarkHeadingIds } from "@thinkrail/plugin-ui/markdown";
import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import { selectSlot, usePluginRegistry } from "../plugins/registry";
import { worktreeFileUrl } from "./filesUrl";
import { openFileInTab } from "./openTabs";
import { specLinkTarget } from "./specDocument";

export { remarkHeadingIds };

function resolveDocumentLink(workspaceId: string, href: string): { path: string } | null {
	for (const resolve of selectSlot(usePluginRegistry.getState(), "documentLink")) {
		const result = resolve(workspaceId, href);
		if (result) return result;
	}
	return null;
}

export type HrefKind = "empty" | "anchor" | "external" | "relative";

export function classifyHref(href: string | undefined): HrefKind {
	if (!href) return "empty";
	if (href.startsWith("#")) return "anchor";
	if (href.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return "external";
	return "relative";
}

export function resolveRelativePath(fromFile: string, href: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(href).replaceAll("\\", "/");
	} catch {
		return null;
	}
	if (!decoded) return null;
	const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
	const segs = decoded.startsWith("/") || dir === "" ? [] : dir.split("/");
	for (const seg of decoded.split("/")) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") {
			if (segs.length === 0) return null;
			segs.pop();
		} else segs.push(seg);
	}
	return segs.join("/") || null;
}

export function slugify(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-");
}

function relativePathname(href: string): string {
	const i = href.search(/[?#]/);
	return i < 0 ? href : href.slice(0, i);
}

function scrollToAnchor(id: string): void {
	document
		.getElementById(decodeURIComponent(id))
		?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function documentComponents(ctx: { workspaceId: string; path: string }): Components {
	function DocumentLink({ href, children }: { href?: string; children?: ReactNode }) {
		const kind = classifyHref(href);
		if (kind === "anchor" && href) {
			return (
				<a
					href={href}
					onClick={(e) => {
						e.preventDefault();
						scrollToAnchor(href.slice(1));
					}}
				>
					{children}
				</a>
			);
		}
		const spec = specLinkTarget(href ?? "");
		if (spec !== null) {
			const path = resolveDocumentLink(ctx.workspaceId, href ?? "")?.path;
			return (
				<button
					type="button"
					data-testid="markdown-spec-link"
					data-spec-id={spec}
					data-path={path ?? undefined}
					disabled={!path}
					title={path ? undefined : `No spec in this workspace has the id ${spec}`}
					onClick={() => {
						if (path) void openFileInTab(ctx.workspaceId, path, "preview");
					}}
					className="cursor-pointer text-left text-primary underline decoration-primary-muted underline-offset-2 hover:decoration-primary disabled:cursor-default disabled:text-text-subtle disabled:no-underline"
				>
					{children}
				</button>
			);
		}
		if (kind === "relative" && href) {
			const target = resolveRelativePath(ctx.path, relativePathname(href));
			return (
				<button
					type="button"
					data-testid="markdown-file-link"
					data-path={target ?? undefined}
					disabled={!target}
					onClick={() => {
						if (target) void openFileInTab(ctx.workspaceId, target, "preview");
					}}
					className="cursor-pointer text-left text-primary underline decoration-primary-muted underline-offset-2 hover:decoration-primary disabled:cursor-default"
				>
					{children}
				</button>
			);
		}
		return (
			<a href={href} target="_blank" rel="noopener noreferrer">
				{children}
			</a>
		);
	}

	function DocumentImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
		const isRelative = classifyHref(src) === "relative" && src !== undefined;
		const target = isRelative ? resolveRelativePath(ctx.path, relativePathname(src)) : null;
		// One place builds a worktree file URL; the PDF preview reads the same one. See panels/SPEC.md.
		const resolved = isRelative
			? target
				? worktreeFileUrl(ctx.workspaceId, target)
				: undefined
			: src;
		return <img src={resolved} alt={alt ?? ""} title={title} />;
	}

	return { a: DocumentLink, img: DocumentImage } as Components;
}
