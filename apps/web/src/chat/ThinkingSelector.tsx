import { RiCheckLine as Check, RiArrowDownSLine as ChevronDown } from "@remixicon/react";
import type { ConfigOption } from "@thinkrail/contracts";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function ThinkingSelector({
	option,
	onSelect,
	container,
}: {
	option: ConfigOption | undefined;
	onSelect: (value: string) => void;
	container?: HTMLElement | null;
}) {
	const [open, setOpen] = useState(false);
	if (option?.control.type !== "select" || option.control.groups.length === 0) {
		return null;
	}
	const { value: currentId, groups } = option.control;
	const choices = groups.flatMap((group) => group.choices);
	const current = choices.find((choice) => choice.id === currentId);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				data-testid="thinking-selector"
				data-open={open}
				className="flex h-8 items-center gap-8 rounded-[var(--radius-sm)] border border-control-border-default bg-clip-padding bg-control-bg px-8 tr-text-ui text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:border-control-border-active data-[open=true]:bg-control-bg-selected"
			>
				<span className="tr-text-eyebrow text-text-muted">{option.name}</span>
				<span className="capitalize">{current?.name ?? currentId}</span>
				<ChevronDown className="size-3 shrink-0 text-text-muted" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-[160px] p-4">
				{choices.map((choice) => (
					<button
						key={choice.id}
						type="button"
						data-testid="thinking-option"
						data-level={choice.id}
						aria-pressed={choice.id === currentId}
						onClick={() => {
							onSelect(choice.id);
							setOpen(false);
						}}
						className="flex w-full items-center gap-8 rounded-[var(--radius-sm)] px-8 py-4 text-left tr-text-ui text-text-default capitalize outline-none transition-colors hover:bg-control-bg-hovered"
					>
						<span className="flex w-3.5 shrink-0 justify-center">
							{choice.id === currentId ? <Check className="size-3.5 text-primary" /> : null}
						</span>
						{choice.name}
					</button>
				))}
			</PopoverContent>
		</Popover>
	);
}
