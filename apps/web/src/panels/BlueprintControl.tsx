import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiLockLine as Lock,
} from "@remixicon/react";
import type { BlueprintControl, BlueprintOption } from "@thinkrail/contracts";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { EditableText } from "./BlueprintEditable";

function OptionText({
	option,
	disabled,
	onEdit,
}: {
	option: BlueprintOption;
	disabled: boolean;
	onEdit: (field: "label" | "axis", text: string) => void;
}) {
	return (
		<span className="min-w-0">
			<EditableText
				value={option.label}
				disabled={disabled}
				testId="blueprint-option-label"
				className="block text-text-default"
				onCommit={(text) => onEdit("label", text)}
			/>
			{option.axis || !disabled ? (
				<EditableText
					value={option.axis}
					disabled={disabled}
					placeholder="why you would pick it"
					testId="blueprint-option-axis"
					className="block tr-text-metadata text-text-muted"
					onCommit={(text) => onEdit("axis", text)}
				/>
			) : null}
		</span>
	);
}

export function BlueprintControlView({
	control,
	disabled,
	changed,
	onToggle,
	onEditOption,
}: {
	control: BlueprintControl;
	disabled: boolean;
	changed: boolean;
	onToggle: (optionId: string) => void;
	onEditOption: (optionId: string, field: "label" | "axis", text: string) => void;
}) {
	const selected = control.options.filter((option) => control.selectedIds.includes(option.id));

	return (
		<div
			data-testid="blueprint-control"
			data-control={control.id}
			data-kind={control.kind}
			data-changed={changed || undefined}
			className={cn(
				"my-12 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-12 py-8",
				changed && "border-l-[3px] border-l-feedback-warning",
			)}
		>
			<div className="flex items-center gap-8">
				<span className="tr-text-eyebrow shrink-0 text-text-subtle">{control.title}</span>
				{control.locked ? (
					<Lock
						className="size-12 shrink-0 text-text-subtle"
						aria-label="You set this — regeneration keeps it"
					/>
				) : null}
				{control.kind === "select" ? (
					<DropdownMenu>
						<DropdownMenuTrigger
							disabled={disabled || control.pending}
							data-testid="blueprint-choice"
							data-value={control.selectedIds.join(" ")}
							className="flex min-w-0 items-center gap-4 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-8 py-4 text-left text-text-default hover:bg-control-bg-hovered disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text"
						>
							<span className="truncate">{selected[0]?.label ?? "…"}</span>
							<ChevronDown className="size-12 shrink-0" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="max-w-[420px]">
							{control.options.map((option) => (
								<DropdownMenuItem
									key={option.id}
									data-testid="blueprint-option"
									data-option={option.id}
									onSelect={() => onToggle(option.id)}
									className="flex items-start gap-8"
								>
									<Check
										className={cn(
											"mt-2 size-12 shrink-0",
											control.selectedIds.includes(option.id) ? "text-primary" : "opacity-0",
										)}
									/>
									<span className="min-w-0">
										<span className="block text-text-default">{option.label}</span>
										{option.axis ? (
											<span className="block tr-text-metadata text-text-muted">{option.axis}</span>
										) : null}
									</span>
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				) : null}
			</div>

			{control.kind === "select" ? (
				// Editable is what the reader can see: for a select that is the chosen option, whose text
				// sits in the document. The alternatives' wording lives in the menu and is the agent's.
				selected[0] ? (
					<div className="mt-4">
						<OptionText
							option={selected[0]}
							disabled={disabled}
							onEdit={(field, text) => {
								const option = selected[0];
								if (option) onEditOption(option.id, field, text);
							}}
						/>
					</div>
				) : null
			) : (
				<ul className="mt-4 flex flex-col gap-4">
					{control.options.map((option) => (
						<li key={option.id} className="flex items-start gap-8">
							<input
								type="checkbox"
								data-testid="blueprint-checkbox"
								data-option={option.id}
								disabled={disabled}
								checked={control.selectedIds.includes(option.id)}
								onChange={() => onToggle(option.id)}
								className="mt-4 size-14 shrink-0 accent-primary"
							/>
							<OptionText
								option={option}
								disabled={disabled}
								onEdit={(field, text) => onEditOption(option.id, field, text)}
							/>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
