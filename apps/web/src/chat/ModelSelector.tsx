import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiEyeLine as Eye,
	RiEyeOffLine as EyeOff,
	RiOpenaiLine as Openai,
	RiRefreshLine as RefreshCw,
} from "@remixicon/react";
import { isModelHidden, matchesModelPattern, type WireModel } from "@thinkrail/contracts";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@thinkrail/plugin-ui";
import { useRef, useState } from "react";
import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

function formatContext(tokens: number): string {
	if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`.replace(".0", "");
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return String(tokens);
}

function subLine(model: WireModel): string {
	const parts = [`${formatContext(model.contextWindow)} context`];
	if (model.reasoning) parts.push("reasoning");
	return parts.join(" · ");
}

function ModelProviderGlyph({ model, className }: { model: WireModel; className?: string }) {
	if (!model.provider.startsWith("openai")) return null;
	return <Openai data-testid="model-provider-mark" className={className} aria-hidden="true" />;
}

function TruncatedModelName({ name }: { name: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	const [open, setOpen] = useState(false);

	const handleOpenChange = (nextOpen: boolean) => {
		if (nextOpen) {
			const el = ref.current;
			if (el && el.scrollWidth > el.clientWidth) {
				setOpen(true);
				return;
			}
		}
		setOpen(false);
	};

	return (
		<Tooltip open={open} onOpenChange={handleOpenChange} delayDuration={0}>
			<TooltipTrigger asChild>
				<span ref={ref} className="truncate">
					{name}
				</span>
			</TooltipTrigger>
			<TooltipContent side="top" align="start">
				{name}
			</TooltipContent>
		</Tooltip>
	);
}

export function ModelSelector({
	models,
	current,
	onSelect,
	refreshing,
	onRefresh,
	container,
	className,
	placeholder,
	defaultOption,
	onSelectDefault,
	showLabel = true,
	hiddenModels: propHiddenModels,
}: {
	models: WireModel[];
	current: WireModel | null;
	onSelect: (model: WireModel) => void;
	refreshing: boolean;
	onRefresh: (force: boolean) => void;
	container?: HTMLElement | null;
	className?: string;
	placeholder?: string;
	defaultOption?: string;
	onSelectDefault?: () => void;
	showLabel?: boolean;
	hiddenModels?: readonly string[];
}) {
	const [open, setOpen] = useState(false);
	const [showHidden, setShowHidden] = useState(false);
	const storeHiddenModels = useAppStore((s) => s.hiddenModels);
	const activeHidden = propHiddenModels ?? storeHiddenModels ?? [];

	const isHidden = (m: WireModel) => isModelHidden(m, activeHidden);
	const hiddenCount = models.filter(isHidden).length;

	const visibleModels = showHidden
		? models
		: models.filter(
				(m) => !isHidden(m) || (current?.provider === m.provider && current?.id === m.id),
			);
	const providers = [...new Set(visibleModels.map((m) => m.provider))];

	const select = (model: WireModel) => {
		onSelect(model);
		setOpen(false);
	};

	const hideModel = (model: WireModel) => {
		if (isModelHidden(model, activeHidden)) return;
		const next = [...activeHidden, model.id];
		getTransport()
			.request("settings.update", { config: { hiddenModels: next } })
			.catch(() => toast.error("Couldn't hide model"));
	};

	const unhideModel = (model: WireModel) => {
		const next = activeHidden.filter((p) => p !== model.id && !matchesModelPattern(model, p));
		getTransport()
			.request("settings.update", { config: { hiddenModels: next } })
			.catch(() => toast.error("Couldn't unhide model"));
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) onRefresh(false);
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
				{showLabel ? <span className="tr-text-eyebrow text-text-muted">Model</span> : null}
				{current ? <ModelProviderGlyph model={current} className="size-14 shrink-0" /> : null}
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
						{defaultOption !== undefined && onSelectDefault !== undefined && (
							<CommandGroup>
								<CommandItem
									value={defaultOption}
									data-testid="model-option-default"
									onSelect={() => {
										onSelectDefault();
										setOpen(false);
									}}
								>
									<span className="flex w-14 shrink-0 justify-center">
										{current === null ? <Check className="size-14 text-primary" /> : null}
									</span>
									<TruncatedModelName name={defaultOption} />
								</CommandItem>
							</CommandGroup>
						)}
						{providers.map((provider) => (
							<CommandGroup key={provider} heading={provider}>
								{visibleModels
									.filter((m) => m.provider === provider)
									.map((m) => {
										const isCurrent = current?.provider === m.provider && current?.id === m.id;
										const hidden = isHidden(m);
										return (
											<CommandItem
												key={`${m.provider}:${m.id}`}
												value={`${m.provider} ${m.name} ${m.id}`}
												data-testid="model-option"
												data-model-id={m.id}
												onSelect={() => select(m)}
												className={cn(hidden && "opacity-60")}
											>
												<span className="flex w-14 shrink-0 justify-center">
													{isCurrent ? <Check className="size-14 text-primary" /> : null}
												</span>
												<span className="flex min-w-0 flex-col">
													<span className="flex items-center gap-4 truncate">
														<ModelProviderGlyph model={m} className="size-14 shrink-0" />
														<TruncatedModelName name={m.name} />
														{hidden ? (
															<span className="rounded bg-control-bg px-4 py-2 tr-text-metadata text-text-muted">
																Hidden
															</span>
														) : null}
													</span>
													<span className="truncate text-text-muted tr-text-metadata">
														{subLine(m)}
													</span>
												</span>
												<span className="ml-auto flex shrink-0 items-center gap-4 text-text-muted tr-text-metadata">
													<span>{m.id}</span>
													{hidden ? (
														<button
															type="button"
															data-testid="model-unhide-button"
															title="Unhide model"
															onPointerDown={(e) => e.stopPropagation()}
															onClick={(e) => {
																e.stopPropagation();
																unhideModel(m);
															}}
															className="rounded p-2 text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-default"
														>
															<Eye className="size-14" />
														</button>
													) : (
														<button
															type="button"
															data-testid="model-hide-button"
															title="Hide model"
															onPointerDown={(e) => e.stopPropagation()}
															onClick={(e) => {
																e.stopPropagation();
																hideModel(m);
															}}
															className="rounded p-2 text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-default"
														>
															<EyeOff className="size-14" />
														</button>
													)}
												</span>
											</CommandItem>
										);
									})}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
				{hiddenCount > 0 ? (
					<button
						type="button"
						data-testid="model-toggle-hidden"
						onClick={() => setShowHidden((prev) => !prev)}
						className="flex w-full items-center gap-8 border-border-default border-t px-8 py-4 tr-text-metadata text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default"
					>
						{showHidden ? (
							<>
								<EyeOff className="size-14 shrink-0" />
								<span>Hide filtered models</span>
							</>
						) : (
							<>
								<Eye className="size-14 shrink-0" />
								<span>
									Show {hiddenCount} hidden model{hiddenCount === 1 ? "" : "s"}
								</span>
							</>
						)}
					</button>
				) : null}
				<button
					type="button"
					data-testid="model-refresh"
					data-refreshing={refreshing}
					disabled={refreshing}
					onClick={() => onRefresh(true)}
					className="flex w-full items-center gap-8 border-border-default border-t px-8 py-4 tr-text-metadata text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-text-muted"
				>
					<RefreshCw className={cn("size-14 shrink-0", refreshing && "animate-spin")} />
					{refreshing ? "Updating catalog…" : "Refresh catalog"}
				</button>
			</PopoverContent>
		</Popover>
	);
}
