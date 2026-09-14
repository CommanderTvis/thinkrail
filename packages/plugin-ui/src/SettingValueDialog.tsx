import { RiAddLine as Plus, RiCloseLine as X } from "@remixicon/react";
import { useRef, useState } from "react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";
import { ToggleSegment } from "./ToggleSegment";

export type SettingValue = string | number | boolean | string[];

export type ValueShape = "text" | "number" | "switch" | "list";

const SHAPES: { value: ValueShape; label: string }[] = [
	{ value: "text", label: "Text" },
	{ value: "number", label: "Number" },
	{ value: "switch", label: "On / off" },
	{ value: "list", label: "List" },
];

export function shapeOf(value: unknown): ValueShape | null {
	if (typeof value === "boolean") return "switch";
	if (typeof value === "number") return "number";
	if (typeof value === "string") return "text";
	if (Array.isArray(value) && value.every((item) => typeof item === "string")) return "list";
	return null;
}

function initialText(value: unknown, shape: ValueShape): string {
	if (shape === "list" || value === undefined || value === null || typeof value === "object")
		return "";
	return String(value);
}

function grow(el: HTMLTextAreaElement | null): void {
	if (!el) return;
	el.style.height = "auto";
	el.style.height = `${el.scrollHeight}px`;
}

function ListEntries({
	prefix,
	items,
	onChange,
}: {
	prefix: string;
	items: string[];
	onChange: (next: string[]) => void;
}) {
	const nextId = useRef(0);
	const [ids, setIds] = useState<number[]>(() => items.map(() => nextId.current++));
	const rows = items.map((item, index) => ({
		id: ids[index] ?? index,
		item,
		index,
	}));

	return (
		<div className="flex flex-col gap-4">
			{rows.map(({ id, item, index }) => (
				<div key={id} className="flex items-start gap-4">
					<textarea
						value={item}
						rows={1}
						spellCheck={false}
						aria-label={`Entry ${index + 1}`}
						data-testid={`${prefix}-value-list-entry`}
						ref={grow}
						onChange={(event) => {
							grow(event.currentTarget);
							onChange(items.map((existing, at) => (at === index ? event.target.value : existing)));
						}}
						className="min-w-0 flex-1 resize-none overflow-hidden rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none focus:border-primary"
					/>
					<button
						type="button"
						data-testid={`${prefix}-value-list-remove`}
						aria-label={`Remove entry ${index + 1}`}
						onClick={() => {
							onChange(items.filter((_, at) => at !== index));
							setIds((current) => current.filter((_, at) => at !== index));
						}}
						className="mt-4 shrink-0 rounded-[var(--radius-sm)] p-2 text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
					>
						<X className="size-14" />
					</button>
				</div>
			))}
			<button
				type="button"
				data-testid={`${prefix}-value-list-add`}
				onClick={() => {
					onChange([...items, ""]);
					setIds((current) => [...current, nextId.current++]);
				}}
				className="flex w-fit items-center gap-4 rounded-[var(--radius-sm)] px-4 py-2 tr-text-metadata text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
			>
				<Plus className="size-14" />
				Add entry
			</button>
		</div>
	);
}

function compose(shape: ValueShape, text: string, on: boolean, items: string[]): SettingValue {
	if (shape === "switch") return on;
	if (shape === "number") return Number(text);
	if (shape === "list") return items.map((item) => item.trim()).filter((item) => item !== "");
	return text;
}

function invalid(shape: ValueShape, text: string, key: string): string | null {
	if (key.trim() === "") return "A key is needed.";
	if (shape === "number" && !Number.isFinite(Number(text))) return "That is not a number.";
	if (shape === "text" && text === "") return "An empty string is probably not what you mean.";
	return null;
}

export function SettingValueDialog({
	testIdPrefix,
	open,
	settingKey,
	currentValue,
	choices,
	shapeFor,
	knownKeys,
	knownKeysOnly = false,
	keyPlaceholder,
	submitLabel,
	onClose,
	onSubmit,
}: {
	testIdPrefix: string;
	open: boolean;
	settingKey: string;
	currentValue: unknown;
	choices?: (key: string) => readonly string[] | undefined;
	shapeFor?: (key: string) => ValueShape | undefined;
	knownKeys: readonly string[];
	knownKeysOnly?: boolean;
	keyPlaceholder?: string;
	submitLabel: string;
	onClose: () => void;
	onSubmit: (key: string, value: SettingValue) => void;
}) {
	const prefix = testIdPrefix;
	const adding = settingKey === "";
	const detected = shapeOf(currentValue) ?? shapeFor?.(settingKey) ?? null;
	const [key, setKey] = useState(settingKey);
	const [shape, setShape] = useState<ValueShape>(detected ?? "text");
	const [keyQuery, setKeyQuery] = useState("");
	const pickKey = (next: string) => {
		setKey(next);
		setKeyQuery("");
		const declared = shapeFor?.(next);
		if (declared) setShape(declared);
	};
	const keyChoices = choices?.(key.trim());
	const [text, setText] = useState(initialText(currentValue, detected ?? "text"));
	const [items, setItems] = useState<string[]>(() =>
		Array.isArray(currentValue) ? currentValue.map(String) : [""],
	);
	const [on, setOn] = useState(currentValue === true);
	const [choice, setChoice] = useState(typeof currentValue === "string" ? currentValue : "");
	const picking = keyChoices !== undefined && keyChoices.length > 0;

	const problem = picking ? (choice === "" ? "Pick a value." : null) : invalid(shape, text, key);
	const submit = () => {
		if (problem) return;
		onSubmit(key.trim(), picking ? choice : compose(shape, text, on, items));
	};
	const datalistId = `${prefix}-known-setting-keys`;

	return (
		<Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
			<DialogContent className="flex w-full max-w-[32rem] flex-col gap-12">
				<DialogHeader>
					<DialogTitle>{adding ? "Add a setting" : `Change ${settingKey}`}</DialogTitle>
				</DialogHeader>

				{adding && knownKeysOnly ? (
					<div className="flex flex-col gap-4">
						<span className="tr-text-metadata text-text-muted">Key</span>
						<Command
							className="rounded-[var(--radius-sm)] border border-border-default"
							data-testid={`${prefix}-value-key-picker`}
						>
							<CommandInput
								value={keyQuery}
								onValueChange={setKeyQuery}
								placeholder={key || keyPlaceholder}
								aria-label="Setting key"
								data-testid={`${prefix}-value-key`}
								className="tr-code-text"
							/>
							<CommandList className="max-h-[12rem]">
								<CommandEmpty>No documented key matches.</CommandEmpty>
								{knownKeys.map((known) => (
									<CommandItem
										key={known}
										value={known}
										onSelect={() => pickKey(known)}
										className="tr-code-text"
									>
										{known}
									</CommandItem>
								))}
							</CommandList>
						</Command>
						{key ? (
							<span
								data-testid={`${prefix}-value-key-picked`}
								className="tr-code-text text-text-default"
							>
								{key}
							</span>
						) : null}
					</div>
				) : adding ? (
					<div className="flex flex-col gap-4">
						<span className="tr-text-metadata text-text-muted">Key</span>
						<input
							value={key}
							onChange={(event) => setKey(event.target.value)}
							list={datalistId}
							spellCheck={false}
							ref={(input) => input?.focus()}
							aria-label="Setting key"
							data-testid={`${prefix}-value-key`}
							placeholder={keyPlaceholder}
							className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none placeholder:text-text-subtle focus:border-primary"
						/>
						<datalist id={datalistId}>
							{knownKeys.map((known) => (
								<option key={known} value={known} />
							))}
						</datalist>
					</div>
				) : null}

				<div className="flex flex-col gap-4">
					<span className="tr-text-metadata text-text-muted">Value</span>
					{picking ? (
						<div
							className="flex flex-wrap items-center gap-8"
							data-testid={`${prefix}-value-choices`}
						>
							{(keyChoices ?? []).map((option) => (
								<ToggleSegment
									key={option}
									testid={`${prefix}-value-choice-${option}`}
									label={option}
									active={choice === option}
									onClick={() => setChoice(option)}
								/>
							))}
						</div>
					) : (
						<>
							{(adding && !shapeFor?.(key.trim())) || detected === null ? (
								<div className="flex items-center gap-8">
									{SHAPES.map((option) => (
										<ToggleSegment
											key={option.value}
											testid={`${prefix}-value-shape-${option.value}`}
											label={option.label}
											active={shape === option.value}
											onClick={() => setShape(option.value)}
										/>
									))}
								</div>
							) : null}

							{shape === "switch" ? (
								<button
									type="button"
									role="switch"
									aria-checked={on}
									aria-label="Value"
									data-testid={`${prefix}-value-switch`}
									data-active={on}
									onClick={() => setOn(!on)}
									className={`self-start rounded-[var(--radius-sm)] border px-12 py-4 tr-text-ui ${
										on
											? "border-primary-muted bg-primary-subtle text-text-default"
											: "border-border-default text-text-muted"
									}`}
								>
									{on ? "true" : "false"}
								</button>
							) : shape === "list" ? (
								<div className="max-h-[50vh] overflow-y-auto" data-testid={`${prefix}-value-list`}>
									<ListEntries prefix={prefix} items={items} onChange={setItems} />
								</div>
							) : (
								<input
									value={text}
									onChange={(event) => setText(event.target.value)}
									inputMode={shape === "number" ? "numeric" : "text"}
									spellCheck={false}
									ref={adding ? undefined : (input) => input?.focus()}
									aria-label="Value"
									data-testid={`${prefix}-value-text`}
									className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none focus:border-primary"
								/>
							)}
						</>
					)}
				</div>

				{problem ? (
					<p
						data-testid={`${prefix}-value-problem`}
						className="tr-text-metadata text-feedback-warning"
					>
						{problem}
					</p>
				) : null}

				<div className="flex items-center justify-end gap-8">
					<button
						type="button"
						onClick={onClose}
						className="rounded-[var(--radius-sm)] border border-border-default px-12 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
					>
						Cancel
					</button>
					<button
						type="button"
						data-testid={`${prefix}-value-continue`}
						disabled={problem !== null}
						onClick={submit}
						className="rounded-[var(--radius-sm)] bg-control-primary-bg px-12 py-4 tr-text-ui text-control-primary-text hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
					>
						{submitLabel}
					</button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
