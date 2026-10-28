import type { ReactNode } from "react";

const GOOGLE_DEVELOPER_BENEFITS_URL = "https://developers.google.com/program";

/** Where Google AI Pro and Ultra subscribers activate the monthly Cloud credits, as a link inside a sentence. */
export function GoogleCreditsLink({ children }: { children?: ReactNode }) {
	return (
		<a
			href={GOOGLE_DEVELOPER_BENEFITS_URL}
			target="_blank"
			rel="noreferrer"
			className="text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
		>
			{children}
		</a>
	);
}
