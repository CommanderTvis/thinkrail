import { useEffect, useState } from "react";
import { cn } from "@/lib";
import { fileIconName, fileIconUrl } from "./fileIcon";

/** One fetch per icon for the life of the page; the browser cache handles the rest. See SPEC.md. */
const markup = new Map<string, Promise<string | null>>();

function loadIcon(name: string): Promise<string | null> {
	const cached = markup.get(name);
	if (cached) return cached;
	const pending = fetch(fileIconUrl(name))
		.then((response) => (response.ok ? response.text() : null))
		.catch(() => null);
	markup.set(name, pending);
	return pending;
}

/**
 * One icon of the generated set, drawn in the colour it inherits: the SVGs are recoloured to
 * `currentColor` at build time, with their pale half kept as reduced alpha, so one asset serves every
 * theme.
 */
export function MaterialIcon({
	name,
	className,
	testid = "material-icon",
}: {
	name: string;
	className?: string | undefined;
	testid?: string;
}) {
	const [svg, setSvg] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setSvg(null);
		void loadIcon(name).then((loaded) => {
			if (!cancelled) setSvg(loaded);
		});
		return () => {
			cancelled = true;
		};
	}, [name]);

	return (
		<span
			aria-hidden="true"
			data-testid={testid}
			data-icon={name}
			className={cn(
				"inline-flex shrink-0 items-center justify-center [&>svg]:size-full",
				className,
			)}
			ref={(node) => {
				if (!node) return;
				// The markup is this app's own build output, parsed rather than assigned as HTML: a document
				// parsed as image/svg+xml runs nothing, and there is no string of ours to trust.
				if (!svg) {
					node.replaceChildren();
					return;
				}
				const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
				const root = parsed.documentElement;
				if (root.nodeName !== "svg") return;
				node.replaceChildren(node.ownerDocument.importNode(root, true));
			}}
		/>
	);
}

/** The icon a file type wears, chosen by path. */
export function FileTypeIcon({
	path,
	className,
}: {
	path: string;
	className?: string | undefined;
}) {
	return <MaterialIcon name={fileIconName(path)} className={className} testid="file-type-icon" />;
}
