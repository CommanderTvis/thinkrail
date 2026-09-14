import { type ReactNode, useEffect, useState } from "react";
import { cn } from "./cn";

/** One fetch per URL for the page's life; the browser cache handles the rest. */
const roots = new Map<string, Promise<Element | null>>();

function loadSvg(url: string): Promise<Element | null> {
	const cached = roots.get(url);
	if (cached) return cached;
	const pending = fetch(url)
		.then((response) => (response.ok ? response.text() : null))
		.then((text) => {
			if (text === null) return null;
			const root = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
			return root.nodeName === "svg" ? root : null;
		})
		.catch(() => null);
	roots.set(url, pending);
	return pending;
}

/**
 * Fetches an SVG asset and inlines it, parsed as `image/svg+xml` and adopted into the DOM rather than
 * assigned as HTML, so it draws in whatever colour it inherits and needs no
 * `dangerouslySetInnerHTML` exemption. `fallback` stands in when the asset cannot be fetched.
 */
export function SvgAsset({
	url,
	className,
	testid,
	name,
	fallback,
}: {
	url: string;
	className?: string | undefined;
	testid?: string | undefined;
	name?: string | undefined;
	fallback?: ReactNode;
}) {
	const [svg, setSvg] = useState<Element | null | undefined>(undefined);

	useEffect(() => {
		let cancelled = false;
		setSvg(undefined);
		void loadSvg(url).then((loaded) => {
			if (!cancelled) setSvg(loaded);
		});
		return () => {
			cancelled = true;
		};
	}, [url]);

	if (svg === null && fallback !== undefined) return fallback;
	return (
		<span
			aria-hidden="true"
			{...(testid !== undefined ? { "data-testid": testid } : {})}
			{...(name !== undefined ? { "data-icon": name } : {})}
			className={cn(
				"inline-flex shrink-0 items-center justify-center [&>svg]:size-full",
				className,
			)}
			ref={(node) => {
				if (!node) return;
				if (!svg) {
					node.replaceChildren();
					return;
				}
				node.replaceChildren(node.ownerDocument.importNode(svg, true));
			}}
		/>
	);
}
