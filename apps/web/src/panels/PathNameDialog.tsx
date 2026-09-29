import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useRef, useState } from "react";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { errorText } from "../transport";

/** A name the host can take as a path under the folder it is typed for: no empty or `..` segment. */
export function validPathName(name: string): boolean {
	const segments = name.split(/[\\/]/);
	return (
		name.trim() === name &&
		!/^[\\/]/.test(name) &&
		segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
	);
}

export function PathNameDialog({
	title,
	kind,
	initialName = "",
	confirmLabel,
	nameExists,
	onCancel,
	onSubmit,
}: {
	title: string;
	kind: "file" | "dir";
	initialName?: string;
	confirmLabel: string;
	nameExists: (name: string) => boolean;
	onCancel: () => void;
	onSubmit: (name: string) => Promise<void>;
}) {
	const [name, setName] = useState(initialName);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const duplicate = validPathName(name) && nameExists(name);
	const displayError = duplicate ? `${name} already exists` : error;
	const valid = validPathName(name) && name !== initialName && !duplicate;
	const submit = async () => {
		if (!valid || busy) return;
		setBusy(true);
		setError(null);
		try {
			await onSubmit(name);
		} catch (cause) {
			setError(errorText(cause));
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog open onOpenChange={(open) => (open || busy ? undefined : onCancel())}>
			<DialogContent
				className="max-w-[24rem]"
				hideClose
				data-testid="path-name-dialog"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					const dot = initialName.lastIndexOf(".");
					inputRef.current?.focus();
					inputRef.current?.setSelectionRange(0, dot > 0 ? dot : initialName.length);
				}}
			>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<label className="flex items-center gap-8 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-8 py-4 focus-within:border-control-border-active">
					<FileTypeIcon
						path={name || (kind === "dir" ? "folder" : "file")}
						kind={kind === "dir" ? "directory" : "file"}
						className="size-16 shrink-0 text-text-muted"
					/>
					<input
						ref={inputRef}
						data-testid="path-name-input"
						aria-label="Name"
						aria-invalid={displayError ? true : undefined}
						aria-describedby={displayError ? "path-name-error" : undefined}
						value={name}
						disabled={busy}
						spellCheck={false}
						onChange={(event) => {
							setName(event.target.value);
							setError(null);
						}}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							void submit();
						}}
						className="min-w-0 flex-1 bg-transparent tr-text-ui text-text-default outline-none placeholder:text-text-muted"
						placeholder={kind === "dir" ? "Folder name" : "File name, e.g. notes.md"}
					/>
				</label>
				{displayError ? (
					<p
						id="path-name-error"
						data-testid="path-name-error"
						role="alert"
						className="tr-text-metadata text-feedback-error"
					>
						{displayError}
					</p>
				) : null}
				<DialogFooter>
					<Button variant="outline" disabled={busy} onClick={onCancel}>
						Cancel
					</Button>
					<Button
						data-testid="path-name-confirm"
						disabled={!valid || busy}
						onClick={() => void submit()}
					>
						{busy ? `${confirmLabel}…` : confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
