import type { ReactNode } from "react";

/** A link to a JetBrains page, inside a sentence. */
export function JetBrainsLink({ href, children }: { href: string; children?: ReactNode }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
		>
			{children}
		</a>
	);
}
