import type { Project } from "@thinkrail/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { errorText, getTransport } from "@/transport";
import { FolderField } from "./FolderField";

const CLONE_TIMEOUT_MS = 10 * 60_000;

const FIELD_CLASS =
	"w-full rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-12 py-8 text-text-default outline-none focus:border-control-border-active";

export function repoNameFromUrl(url: string): string {
	const tail =
		url
			.trim()
			.replace(/[/\\]+$/, "")
			.split(/[/\\:]/)
			.pop() ?? "";
	return tail.replace(/\.git$/, "");
}

export function CloneProjectDialog({
	onOpenChange,
	onCloned,
}: {
	onOpenChange: (open: boolean) => void;
	onCloned: (project: Project) => void | Promise<void>;
}) {
	const [url, setUrl] = useState("");
	const [parent, setParent] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [depth, setDepth] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const trimmedUrl = url.trim();
	const derivedName = repoNameFromUrl(url);
	const folder = name.trim() || derivedName;
	const depthValue = depth.trim() === "" ? undefined : Number(depth);
	const depthValid = depthValue === undefined || (Number.isInteger(depthValue) && depthValue >= 1);
	const ready = Boolean(parent && trimmedUrl && folder) && depthValid && !busy;
	const target = parent && folder ? `${parent.replace(/\/$/, "")}/${folder}` : null;

	const clone = async () => {
		if (!parent) return;
		setBusy(true);
		setError(null);
		try {
			const project = await getTransport().request(
				"project.clone",
				{
					url: trimmedUrl,
					parentPath: parent,
					name: folder,
					...(depthValue === undefined ? {} : { depth: depthValue }),
				},
				{ timeoutMs: CLONE_TIMEOUT_MS },
			);
			await onCloned(project);
			onOpenChange(false);
		} catch (err) {
			setError(errorText(err, "Couldn't clone the repository."));
			setBusy(false);
		}
	};

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent data-testid="clone-project-dialog" className="max-w-[560px]">
				<DialogHeader>
					<DialogTitle>Clone repository</DialogTitle>
					<DialogDescription>
						Runs <code className="tr-code-text">git clone</code> into a folder you choose, then
						opens the clone as a project.
					</DialogDescription>
				</DialogHeader>

				<input
					data-testid="clone-project-url"
					value={url}
					placeholder="Repository URL"
					autoFocus
					spellCheck={false}
					onChange={(event) => setUrl(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && ready) void clone();
					}}
					className={FIELD_CLASS}
				/>

				<FolderField
					value={parent}
					placeholder="Choose the folder to clone into…"
					testId="clone-project-parent"
					onPick={setParent}
					onError={setError}
				/>

				<label
					className={`${FIELD_CLASS} flex items-center gap-8 focus-within:border-control-border-active`}
				>
					<span className="shrink-0 tr-text-eyebrow text-text-muted">Folder name</span>
					<input
						data-testid="clone-project-name"
						value={name}
						placeholder={derivedName || "from the URL"}
						spellCheck={false}
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && ready) void clone();
						}}
						className="min-w-0 flex-1 bg-transparent outline-none"
					/>
					<span className="shrink-0 tr-text-metadata text-text-muted">optional</span>
				</label>

				<label
					className={`${FIELD_CLASS} flex items-center gap-8 focus-within:border-control-border-active`}
				>
					<span className="shrink-0 tr-text-eyebrow text-text-muted">Depth</span>
					<input
						data-testid="clone-project-depth"
						type="number"
						min={1}
						step={1}
						value={depth}
						placeholder="full history"
						onChange={(event) => setDepth(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && ready) void clone();
						}}
						className="min-w-0 flex-1 bg-transparent outline-none"
					/>
					<span className="shrink-0 tr-text-metadata text-text-muted">
						optional · 1 for a shallow clone
					</span>
				</label>

				{target ? (
					<p
						data-testid="clone-project-target"
						className="break-all tr-text-metadata text-text-muted"
					>
						{target}
					</p>
				) : null}
				{error ? (
					<p data-testid="clone-project-error" className="tr-text-metadata text-feedback-error">
						{error}
					</p>
				) : null}

				<div className="flex justify-end">
					<Button data-testid="clone-project-create" disabled={!ready} onClick={() => void clone()}>
						{busy ? "Cloning…" : "Clone"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
