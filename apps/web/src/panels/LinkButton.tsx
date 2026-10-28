import type { ButtonHTMLAttributes } from "react";

/** An action that reads as a link inside a sentence, for what opens a dialog rather than a page. */
export function LinkButton({ type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button
			type={type}
			className="text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary disabled:text-text-muted disabled:no-underline"
			{...props}
		/>
	);
}
