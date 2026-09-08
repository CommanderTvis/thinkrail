import { RiPencilRuler2Line as PencilRuler } from "@remixicon/react";
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

export function NewProjectDialog({
	onOpenChange,
	onCreated,
	onDraftBlueprint,
}: {
	onOpenChange: (open: boolean) => void;
	onCreated: (project: Project) => void | Promise<void>;
	onDraftBlueprint: (project: Project) => void;
}) {
	const [parent, setParent] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [created, setCreated] = useState<Project | null>(null);

	const trimmed = name.trim();
	const target = parent && trimmed ? `${parent.replace(/\/$/, "")}/${trimmed}` : null;

	const create = async () => {
		if (!parent) return;
		setBusy(true);
		setError(null);
		try {
			const project = await getTransport().request("project.create", { parentPath: parent, name });
			await onCreated(project);
			setCreated(project);
		} catch (err) {
			setError(errorText(err, "Couldn't create the project."));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent data-testid="new-project-dialog" className="max-w-[560px]">
				{created ? (
					<>
						<DialogHeader>
							<DialogTitle>{created.name} is ready</DialogTitle>
							<DialogDescription>
								A git repository with one empty commit, so you can cut a workspace from it straight
								away. Nothing else is in it — the working tree is yours to fill.
							</DialogDescription>
						</DialogHeader>
						<p className="break-all tr-text-metadata text-text-muted">{created.path}</p>
						<div className="flex justify-end gap-8">
							<Button
								variant="ghost"
								size="sm"
								data-testid="new-project-done"
								onClick={() => onOpenChange(false)}
							>
								Not now
							</Button>
							<Button
								size="sm"
								data-testid="new-project-blueprint"
								onClick={() => onDraftBlueprint(created)}
							>
								<PencilRuler className="size-16" />
								Draft a blueprint
							</Button>
						</div>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>New project</DialogTitle>
							<DialogDescription>
								Creates the folder and runs <code className="tr-code-text">git init</code> in it.
								Nothing is committed.
							</DialogDescription>
						</DialogHeader>

						<FolderField
							value={parent}
							placeholder="Choose the folder to create it in…"
							testId="new-project-parent"
							onPick={setParent}
							onError={setError}
						/>

						<input
							data-testid="new-project-name"
							value={name}
							placeholder="Project name"
							onChange={(event) => setName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && parent && trimmed) void create();
							}}
							className="w-full rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-12 py-8 text-text-default outline-none focus:border-control-border-active"
						/>

						{target ? (
							<p
								data-testid="new-project-target"
								className="break-all tr-text-metadata text-text-muted"
							>
								{target}
							</p>
						) : null}
						{error ? (
							<p data-testid="new-project-error" className="tr-text-metadata text-feedback-error">
								{error}
							</p>
						) : null}

						<div className="flex justify-end">
							<Button
								data-testid="new-project-create"
								disabled={busy || !parent || !trimmed}
								onClick={() => void create()}
							>
								{busy ? "Creating…" : "Create"}
							</Button>
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
