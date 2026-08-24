import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type * as React from "react";
import { cn } from "@/lib";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

function TooltipContent({
	className,
	sideOffset = 4,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				data-slot="tooltip-content"
				sideOffset={sideOffset}
				className={cn(
					// `pointer-events-none`: a tooltip is a label, never a target — see components/ui/SPEC.md.
					"pointer-events-none z-50 overflow-hidden rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-8 py-4 text-text-default tr-text-metadata shadow-[var(--shadow-sm)]",
					className,
				)}
				{...props}
			/>
		</TooltipPrimitive.Portal>
	);
}

function IconTooltip({
	label,
	side,
	align,
	wrapTrigger,
	delayDuration,
	children,
}: {
	label: React.ReactNode;
	side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
	align?: React.ComponentProps<typeof TooltipPrimitive.Content>["align"];
	wrapTrigger?: boolean;
	/** Overrides the provider's hover delay — `0` for a label that *replaces* unreadable truncated text. */
	delayDuration?: number;
	children: React.ReactNode;
}) {
	return (
		<Tooltip {...(delayDuration === undefined ? {} : { delayDuration })}>
			{wrapTrigger ? (
				<TooltipTrigger asChild>
					<span className="flex">{children}</span>
				</TooltipTrigger>
			) : (
				<TooltipTrigger asChild>{children}</TooltipTrigger>
			)}
			<TooltipContent {...(side ? { side } : {})} {...(align ? { align } : {})}>
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

export { IconTooltip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
