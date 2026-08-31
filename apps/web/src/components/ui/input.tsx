import type * as React from "react";
import { cn } from "@/lib";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			className={cn(
				"h-32 w-full rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-12 tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-muted focus-visible:border-control-border-active disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text",
				className,
			)}
			{...props}
		/>
	);
}
