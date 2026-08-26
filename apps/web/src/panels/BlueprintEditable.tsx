import { RiPencilLine as Pencil } from "@remixicon/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Click to edit, Escape to abandon, blur or Cmd/Ctrl+Enter to commit. The committed value is staged, not
 * reacted to — the document only regenerates once the reader confirms. See panels/SPEC.md.
 */
export function EditableText({
	value,
	disabled,
	placeholder,
	testId,
	className,
	multiline,
	onCommit,
	render,
}: {
	value: string;
	disabled: boolean;
	placeholder?: string;
	testId: string;
	className?: string;
	multiline?: boolean;
	onCommit: (text: string) => void;
	/** How the committed value reads when not being edited; plain text when absent. */
	render?: (value: string) => ReactNode;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value);
	const ref = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!editing) setDraft(value);
	}, [editing, value]);

	useEffect(() => {
		const field = ref.current;
		if (!editing || !field) return;
		field.focus();
		field.setSelectionRange(field.value.length, field.value.length);
		field.style.height = "auto";
		field.style.height = `${field.scrollHeight}px`;
	}, [editing]);

	const commit = () => {
		setEditing(false);
		const text = multiline ? draft.trim() : draft.replace(/\s+/g, " ").trim();
		if (text !== value) onCommit(text);
	};

	if (editing) {
		return (
			<textarea
				ref={ref}
				data-testid={`${testId}-input`}
				value={draft}
				rows={multiline ? 3 : 1}
				onChange={(event) => {
					setDraft(event.target.value);
					const field = event.target;
					field.style.height = "auto";
					field.style.height = `${field.scrollHeight}px`;
				}}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						setDraft(value);
						setEditing(false);
						return;
					}
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey || !multiline)) {
						event.preventDefault();
						commit();
					}
				}}
				className={cn(
					"w-full resize-none rounded-[var(--radius-sm)] border border-control-border-active bg-control-bg px-4 py-2 text-text-default outline-none",
					className,
				)}
			/>
		);
	}

	// Not a <button>: the rendered prose is selectable text the reader drags over and sends to the agent,
	// and a whole paragraph announced as one button is wrong for a screen reader anyway. The action is
	// its own small button, shown on hover and always reachable by keyboard. See panels/SPEC.md.
	return (
		<div
			data-testid={testId}
			className={cn(
				"group relative w-full rounded-[var(--radius-sm)] border border-transparent px-4 py-2 pr-24 text-left",
				!disabled && "hover:border-border-default hover:bg-control-bg-hovered",
				className,
			)}
		>
			{disabled ? null : (
				<button
					type="button"
					data-testid={`${testId}-edit`}
					aria-label="Edit"
					onClick={() => setEditing(true)}
					className="absolute top-2 right-2 rounded-[var(--radius-sm)] p-2 text-text-subtle opacity-0 transition-opacity hover:bg-control-bg-hovered hover:text-text-default focus-visible:opacity-100 group-hover:opacity-100"
				>
					<Pencil className="size-14" />
				</button>
			)}
			{value ? (
				(render?.(value) ?? value)
			) : (
				<span className="text-text-disabled">{placeholder ?? "Add a line…"}</span>
			)}
		</div>
	);
}
