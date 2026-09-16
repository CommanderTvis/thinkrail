import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
} from "@remixicon/react";

/** The clickable heading of one remote's collapsible group, shared by every branch picker and list. */
export function RemoteGroupHeading({
	label,
	collapsed,
	onToggle,
}: {
	label: string;
	collapsed: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			data-testid="remote-group-toggle"
			data-remote={label}
			data-collapsed={collapsed || undefined}
			aria-expanded={!collapsed}
			onClick={(event) => {
				event.stopPropagation();
				onToggle();
			}}
			className="flex w-full items-center gap-4 text-left text-text-muted hover:text-text-default"
		>
			{collapsed ? (
				<ChevronRight className="size-12 shrink-0" />
			) : (
				<ChevronDown className="size-12 shrink-0" />
			)}
			<span className="truncate">{label}</span>
		</button>
	);
}
