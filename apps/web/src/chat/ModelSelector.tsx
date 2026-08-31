import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiRefreshLine as RefreshCw,
} from "@remixicon/react";
import type { ConfigChoiceMeta, ConfigOption } from "@thinkrail/contracts";
import { useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib";

function formatContext(tokens: number): string {
	if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`.replace(".0", "");
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return String(tokens);
}

function subLine(meta: ConfigChoiceMeta | undefined): string | null {
	if (!meta) return null;
	const parts: string[] = [];
	if (meta.contextWindow !== undefined) parts.push(`${formatContext(meta.contextWindow)} context`);
	if (meta.reasoning) parts.push("reasoning");
	return parts.length > 0 ? parts.join(" · ") : null;
}

export function ModelSelector({
	option,
	onSelect,
	refreshing = false,
	onRefresh,
	container,
	className,
	placeholder,
}: {
	option: ConfigOption | undefined;
	onSelect: (value: string) => void;
	refreshing?: boolean;
	onRefresh?: (force: boolean) => void;
	container?: HTMLElement | null;
	className?: string;
	placeholder?: string;
}) {
	const [open, setOpen] = useState(false);
	if (option?.control.type !== "select" || option.control.groups.length === 0) {
		return null;
	}
	const { value: currentId, groups } = option.control;
	const current = groups
		.flatMap((group) => group.choices)
		.find((choice) => choice.id === currentId);

	const select = (id: string) => {
		onSelect(id);
		setOpen(false);
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) onRefresh?.(false);
			}}
		>
			<PopoverTrigger
				data-testid="model-selector"
				data-open={open}
				className={cn(
					"flex h-32 max-w-[220px] items-center gap-8 rounded-[var(--radius-sm)] border border-control-border-default bg-clip-padding bg-control-bg px-8 tr-text-ui text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:border-control-border-active data-[open=true]:bg-control-bg-selected",
					className,
				)}
			>
				<span className="truncate text-text-muted tr-text-metadata">
					{current?.name ?? (placeholder || "Select model")}
				</span>
				<ChevronDown className="size-16 shrink-0 text-text-muted" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-[320px] p-0">
				<Command>
					<CommandInput placeholder="Search models…" />
					<CommandList>
						<CommandEmpty>No models found.</CommandEmpty>
						{groups.map((group) => (
							<CommandGroup key={group.id} heading={group.name ?? undefined}>
								{group.choices.map((choice) => {
									const isCurrent = choice.id === currentId;
									const sub = subLine(choice.meta);
									return (
										<CommandItem
											key={choice.id}
											value={`${group.name ?? ""} ${choice.name} ${choice.id}`}
											data-testid="model-option"
											data-model-id={choice.id}
											onSelect={() => select(choice.id)}
										>
											<span className="flex w-3.5 shrink-0 justify-center">
												{isCurrent ? <Check className="size-3.5 text-primary" /> : null}
											</span>
											<span className="flex min-w-0 flex-col">
												<span className="truncate">{choice.name}</span>
												{sub ? (
													<span className="truncate text-text-muted tr-text-metadata">{sub}</span>
												) : null}
											</span>
											<span className="ml-auto shrink-0 text-text-muted tr-text-metadata">
												{choice.id}
											</span>
										</CommandItem>
									);
								})}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
				{onRefresh ? (
					<button
						type="button"
						data-testid="model-refresh"
						data-refreshing={refreshing}
						disabled={refreshing}
						onClick={() => onRefresh(true)}
						className="flex w-full items-center gap-8 border-border-default border-t px-8 py-4 tr-text-metadata text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-text-muted"
					>
						<RefreshCw className={cn("size-3.5 shrink-0", refreshing && "animate-spin")} />
						{refreshing ? "Updating catalog…" : "Refresh catalog"}
					</button>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
