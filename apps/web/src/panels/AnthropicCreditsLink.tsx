import type { ReactNode } from "react";

const ANTHROPIC_SUBSCRIBER_CREDITS_URL =
	"https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers";

/** Anthropic's guide to the API credits included with Claude Max and Team, as a link inside a sentence. */
export function AnthropicCreditsLink({ children }: { children?: ReactNode }) {
	return (
		<a
			href={ANTHROPIC_SUBSCRIBER_CREDITS_URL}
			target="_blank"
			rel="noreferrer"
			className="text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
		>
			{children}
		</a>
	);
}
