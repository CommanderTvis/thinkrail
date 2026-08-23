import { RiAddLine as Plus, RiCloseLine as X } from "@remixicon/react";
import type { ClaudeEdit, ClaudeSettingInput } from "@thinkrail/contracts";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { ToggleSegment } from "./ToggleSegment";

export type ValueShape = "text" | "number" | "switch" | "list";

const SHAPES: { value: ValueShape; label: string }[] = [
	{ value: "text", label: "Text" },
	{ value: "number", label: "Number" },
	{ value: "switch", label: "On / off" },
	{ value: "list", label: "List" },
];

/** What a value already is decides how it is edited; a key nobody has set yet has to be told. */
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

/** One row per entry, each growing to its content — an entry can be a sentence, not just a rule. */
function ListEntries({ items, onChange }: { items: string[]; onChange: (next: string[]) => void }) {
	return (
		<div className="flex flex-col gap-4">
			{items.map((item, index) => (
				<div key={index} className="flex items-start gap-4">
					<textarea
						value={item}
						rows={1}
						spellCheck={false}
						aria-label={`Entry ${index + 1}`}
						data-testid="claude-value-list-entry"
						ref={grow}
						onChange={(event) => {
							grow(event.currentTarget);
							onChange(items.map((existing, at) => (at === index ? event.target.value : existing)));
						}}
						className="min-w-0 flex-1 resize-none overflow-hidden rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none focus:border-primary"
					/>
					<button
						type="button"
						data-testid="claude-value-list-remove"
						aria-label={`Remove entry ${index + 1}`}
						onClick={() => onChange(items.filter((_, at) => at !== index))}
						className="mt-4 shrink-0 rounded-[var(--radius-sm)] p-2 text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
					>
						<X className="size-14" />
					</button>
				</div>
			))}
			<button
				type="button"
				data-testid="claude-value-list-add"
				onClick={() => onChange([...items, ""])}
				className="flex w-fit items-center gap-4 rounded-[var(--radius-sm)] px-4 py-2 tr-text-metadata text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
			>
				<Plus className="size-14" />
				Add entry
			</button>
		</div>
	);
}

function compose(
	shape: ValueShape,
	text: string,
	on: boolean,
	items: string[],
): ClaudeSettingInput {
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

/** Compose the value, before anything is asked about where it goes — see panels/SPEC.md. */
export function ClaudeValueDialog({
	open,
	settingKey,
	currentValue,
	knownKeys,
	onClose,
	onCompose,
}: {
	open: boolean;
	/** Empty when the key is being added rather than changed. */
	settingKey: string;
	currentValue: unknown;
	knownKeys: readonly string[];
	onClose: () => void;
	onCompose: (pending: { edit: ClaudeEdit; title: string }) => void;
}) {
	const adding = settingKey === "";
	const detected = shapeOf(currentValue);
	const [key, setKey] = useState(settingKey);
	const [shape, setShape] = useState<ValueShape>(detected ?? "text");
	const [text, setText] = useState(initialText(currentValue, detected ?? "text"));
	const [items, setItems] = useState<string[]>(() =>
		Array.isArray(currentValue) ? currentValue.map(String) : [""],
	);
	const [on, setOn] = useState(currentValue === true);

	const problem = invalid(shape, text, key);
	const submit = () => {
		if (problem) return;
		onCompose({
			edit: { kind: "setting", key: key.trim(), value: compose(shape, text, on, items) },
			title: adding ? `Add "${key.trim()}"` : `Change "${key.trim()}"`,
		});
	};

	return (
		<Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
			<DialogContent className="flex w-full max-w-[32rem] flex-col gap-12">
				<DialogHeader>
					<DialogTitle>{adding ? "Add a setting" : `Change ${settingKey}`}</DialogTitle>
				</DialogHeader>

				{adding ? (
					<div className="flex flex-col gap-4">
						<span className="tr-text-metadata text-text-muted">Key</span>
						<input
							value={key}
							onChange={(event) => setKey(event.target.value)}
							list="claude-known-setting-keys"
							spellCheck={false}
							autoFocus
							aria-label="Setting key"
							data-testid="claude-value-key"
							placeholder="permissions.defaultMode"
							className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none placeholder:text-text-subtle focus:border-primary"
						/>
						{/* Offered, never imposed: an unlisted key is newer than our list, not invalid. */}
						<datalist id="claude-known-setting-keys">
							{knownKeys.map((known) => (
								<option key={known} value={known} />
							))}
						</datalist>
					</div>
				) : null}

				<div className="flex flex-col gap-4">
					<span className="tr-text-metadata text-text-muted">Value</span>
					{adding || detected === null ? (
						<div className="flex items-center gap-8">
							{SHAPES.map((option) => (
								<ToggleSegment
									key={option.value}
									testid={`claude-value-shape-${option.value}`}
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
							data-testid="claude-value-switch"
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
						<div className="max-h-[50vh] overflow-y-auto" data-testid="claude-value-list">
							<ListEntries items={items} onChange={setItems} />
						</div>
					) : (
						<input
							value={text}
							onChange={(event) => setText(event.target.value)}
							inputMode={shape === "number" ? "numeric" : "text"}
							spellCheck={false}
							autoFocus={!adding}
							aria-label="Value"
							data-testid="claude-value-text"
							className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none focus:border-primary"
						/>
					)}
				</div>

				{problem ? (
					<p data-testid="claude-value-problem" className="tr-text-metadata text-feedback-warning">
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
						data-testid="claude-value-continue"
						disabled={problem !== null}
						onClick={submit}
						className="rounded-[var(--radius-sm)] bg-control-primary-bg px-12 py-4 tr-text-ui text-control-primary-text hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
					>
						Review the change
					</button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
