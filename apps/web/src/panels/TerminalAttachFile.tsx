import { RiAttachment2, RiFolderLine } from "@remixicon/react";
import type { FileNode } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { FileTypeIcon } from "../components/FileTypeIcon";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { toast } from "../store";
import { errorText, getTransport } from "../transport";

function parentOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash <= 0 ? "" : path.slice(0, slash);
}

/**
 * `@path` is Claude Code's own way of putting a file or a directory in front of the agent, so the chip
 * types one rather than inventing a ThinkRail-only channel — see panels/SPEC.md.
 */
export function TerminalAttachFile({
	workspaceId,
	onAttach,
}: {
	workspaceId: string;
	onAttach: (path: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [dir, setDir] = useState("");
	const [entries, setEntries] = useState<FileNode[]>([]);
	const [filter, setFilter] = useState("");

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		getTransport()
			.request("fs.readDir", { workspaceId, path: dir })
			.then((nodes) => {
				if (!cancelled) setEntries(nodes);
			})
			.catch(() => {
				if (!cancelled) setEntries([]);
			});
		return () => {
			cancelled = true;
		};
	}, [open, dir, workspaceId]);

	const attach = (path: string): void => {
		onAttach(path);
		setOpen(false);
		setDir("");
		setFilter("");
	};

	// The worktree is where the agent works, not the limit of what it may be shown, and reaching outside
	// it is the host's own picker — the same one "Open project" uses. See panels/SPEC.md.
	const browse = (): void => {
		getTransport()
			.request("dialog.selectFile", {})
			.then(({ path }) => {
				if (path) attach(path);
			})
			.catch((cause: unknown) =>
				toast.error(errorText(cause), "Couldn't open the file picker on the host"),
			);
	};

	const needle = filter.trim().toLowerCase();
	const shown = entries
		.filter((entry) => entry.name.toLowerCase().includes(needle))
		.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));

	return (
		<>
			<button
				type="button"
				data-testid="terminal-attach-file"
				title="Put a file or folder in front of Claude, as @path"
				onClick={() => setOpen(true)}
				className="flex shrink-0 items-center gap-4 rounded-[var(--radius-sm)] bg-container-elevated-bg px-4 tr-text-label-pill text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			>
				<RiAttachment2 className="size-12" /> attach file
			</button>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="flex w-full max-w-[34rem] flex-col gap-8">
					<DialogHeader>
						<DialogTitle>Attach a file or folder</DialogTitle>
					</DialogHeader>

					<input
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
						spellCheck={false}
						autoFocus
						aria-label="Filter"
						data-testid="terminal-attach-filter"
						placeholder="Filter this folder…"
						className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none focus-visible:border-primary"
					/>

					<div className="flex items-center gap-4 tr-text-metadata text-text-muted">
						<span data-testid="terminal-attach-dir">/{dir}</span>
						<button
							type="button"
							data-testid="terminal-attach-browse"
							onClick={browse}
							className="rounded-[var(--radius-sm)] px-4 hover:bg-control-bg-hovered hover:text-text-default"
						>
							elsewhere…
						</button>
						{dir === "" ? null : (
							<button
								type="button"
								data-testid="terminal-attach-up"
								onClick={() => setDir(parentOf(dir))}
								className="rounded-[var(--radius-sm)] px-4 hover:bg-control-bg-hovered hover:text-text-default"
							>
								up
							</button>
						)}
						{dir === "" ? null : (
							<button
								type="button"
								data-testid="terminal-attach-this-folder"
								onClick={() => attach(dir)}
								className="ml-auto rounded-[var(--radius-sm)] px-4 hover:bg-control-bg-hovered hover:text-text-default"
							>
								attach this folder
							</button>
						)}
					</div>

					<div className="flex max-h-[18rem] flex-col overflow-y-auto">
						{shown.map((entry) => (
							<button
								key={entry.path}
								type="button"
								data-testid="terminal-attach-entry"
								data-kind={entry.kind}
								data-path={entry.path}
								onClick={() => (entry.kind === "dir" ? setDir(entry.path) : attach(entry.path))}
								className="flex items-center gap-8 rounded-[var(--radius-sm)] px-8 py-4 text-left tr-text-ui text-text-default hover:bg-control-bg-hovered"
							>
								{entry.kind === "dir" ? (
									<RiFolderLine className="size-16 shrink-0 text-text-muted" />
								) : (
									<FileTypeIcon path={entry.name} className="size-16 text-text-muted" />
								)}
								<span className="truncate">{entry.name}</span>
							</button>
						))}
						{shown.length === 0 ? (
							<p className="px-8 py-4 tr-text-metadata text-text-muted">Nothing here.</p>
						) : null}
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
