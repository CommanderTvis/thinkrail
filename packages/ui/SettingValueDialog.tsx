import { RiAddLine as Plus, RiCloseLine as X } from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { useRef, useState } from "react";
import { Button } from "./button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";
import { ToggleSegment } from "./ToggleSegment";

export type SettingValue = string | number | boolean | string[];

export type ValueShape = "text" | "number" | "switch" | "list";

const SHAPES: { value: ValueShape; labelKey: MessageKey }[] = [
	{ value: "text", labelKey: "ui.settingValue.shape.text" },
	{ value: "number", labelKey: "ui.settingValue.shape.number" },
	{ value: "switch", labelKey: "ui.settingValue.shape.switch" },
	{ value: "list", labelKey: "ui.settingValue.shape.list" },
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
	const t = useT();
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
						aria-label={t("ui.settingValue.entry", { index: index + 1 })}
						data-testid={`${prefix}-value-list-entry`}
						ref={grow}
						onChange={(event) => {
							grow(event.currentTarget);
							onChange(items.map((existing, at) => (at === index ? event.target.value : existing)));
						}}
						className="min-w-0 flex-1 resize-none overflow-hidden rounded-sm border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none focus:border-primary"
					/>
					<button
						type="button"
						data-testid={`${prefix}-value-list-remove`}
						aria-label={t("ui.settingValue.removeEntry", { index: index + 1 })}
						onClick={() => {
							onChange(items.filter((_, at) => at !== index));
							setIds((current) => current.filter((_, at) => at !== index));
						}}
						className="mt-4 shrink-0 rounded-sm p-2 text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
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
				className="flex w-fit items-center gap-4 rounded-sm px-4 py-2 tr-text-metadata text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
			>
				<Plus className="size-14" />
				{t("ui.frontmatter.addEntry")}
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
	const t = useT();
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
					<DialogTitle>
						{adding
							? t("ui.settingValue.addTitle")
							: t("ui.settingValue.changeTitle", { key: settingKey })}
					</DialogTitle>
				</DialogHeader>

				{adding && knownKeysOnly ? (
					<div className="flex flex-col gap-4">
						<span className="tr-text-metadata text-text-muted">{t("ui.settingValue.key")}</span>
						<Command
							className="rounded-sm border border-border-default"
							data-testid={`${prefix}-value-key-picker`}
						>
							<CommandInput
								value={keyQuery}
								onValueChange={setKeyQuery}
								placeholder={key || keyPlaceholder}
								aria-label={t("ui.settingValue.keyLabel")}
								data-testid={`${prefix}-value-key`}
								className="tr-code-text"
							/>
							<CommandList className="max-h-[12rem]">
								<CommandEmpty>{t("ui.settingValue.noKeyMatch")}</CommandEmpty>
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
						<span className="tr-text-metadata text-text-muted">{t("ui.settingValue.key")}</span>
						<input
							value={key}
							onChange={(event) => setKey(event.target.value)}
							list={datalistId}
							spellCheck={false}
							ref={(input) => input?.focus()}
							aria-label={t("ui.settingValue.keyLabel")}
							data-testid={`${prefix}-value-key`}
							placeholder={keyPlaceholder}
							className="rounded-sm border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none placeholder:text-text-subtle focus:border-primary"
						/>
						<datalist id={datalistId}>
							{knownKeys.map((known) => (
								<option key={known} value={known} />
							))}
						</datalist>
					</div>
				) : null}

				<div className="flex flex-col gap-4">
					<span className="tr-text-metadata text-text-muted">{t("ui.settingValue.value")}</span>
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
											label={t(option.labelKey)}
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
									aria-label={t("ui.settingValue.value")}
									data-testid={`${prefix}-value-switch`}
									data-active={on}
									onClick={() => setOn(!on)}
									className={`self-start rounded-sm border px-12 py-4 tr-text-ui ${
										on
											? "border-primary-muted bg-primary-subtle text-text-default"
											: "border-border-default text-text-muted"
									}`}
								>
									{on ? t("ui.settingValue.true") : t("ui.settingValue.false")}
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
									aria-label={t("ui.settingValue.value")}
									data-testid={`${prefix}-value-text`}
									className="rounded-sm border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none focus:border-primary"
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
					<Button variant="outline" size="m" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button
						variant="primary"
						size="m"
						data-testid={`${prefix}-value-continue`}
						disabled={problem !== null}
						onClick={submit}
					>
						{submitLabel}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
