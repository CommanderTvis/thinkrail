import { useRef, useState } from "react";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

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
	onCancel,
	onSubmit,
}: {
	title: string;
	kind: "file" | "dir";
	initialName?: string;
	confirmLabel: string;
	onCancel: () => void;
	onSubmit: (name: string) => void;
}) {
	const [name, setName] = useState(initialName);
	const inputRef = useRef<HTMLInputElement>(null);
	const valid = validPathName(name) && name !== initialName;
	const submit = () => {
		if (valid) onSubmit(name);
	};
	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
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
						value={name}
						spellCheck={false}
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							submit();
						}}
						className="min-w-0 flex-1 bg-transparent tr-text-ui text-text-default outline-none placeholder:text-text-muted"
						placeholder={kind === "dir" ? "Folder name" : "File name, e.g. notes.md"}
					/>
				</label>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button data-testid="path-name-confirm" disabled={!valid} onClick={submit}>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
