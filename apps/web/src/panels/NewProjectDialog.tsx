import type { Project } from "@thinkrail/contracts";
import { T, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useState } from "react";
import { selectProjectActions, usePluginRegistry } from "@/plugins/registry";
import { errorText, getTransport } from "@/transport";
import { FolderField } from "./FolderField";

export function NewProjectDialog({
	onOpenChange,
	onCreated,
}: {
	onOpenChange: (open: boolean) => void;
	onCreated: (project: Project) => void | Promise<void>;
}) {
	const t = useT();
	const [parent, setParent] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [created, setCreated] = useState<Project | null>(null);
	const projectActions = usePluginRegistry(selectProjectActions);

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
			setError(errorText(err, t("panels.newProject.createFailed")));
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
							<DialogTitle>{t("panels.newProject.ready", { name: created.name })}</DialogTitle>
							<DialogDescription>{t("panels.newProject.readyDescription")}</DialogDescription>
						</DialogHeader>
						<p className="break-all tr-text-metadata text-text-muted">{created.path}</p>
						{projectActions.length > 0 ? (
							<div className="flex flex-wrap justify-center gap-8">
								{projectActions.map((action) => (
									<action.value.component key={action.pluginId} projectId={created.id} />
								))}
							</div>
						) : null}
						<div className="flex justify-end gap-8">
							<Button size="sm" data-testid="new-project-done" onClick={() => onOpenChange(false)}>
								{t("common.done")}
							</Button>
						</div>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>{t("panels.addProject.newProject")}</DialogTitle>
							<DialogDescription>
								<T
									i18nKey="panels.newProject.description"
									components={[<code key="git-init" className="tr-code-text" />]}
								/>
							</DialogDescription>
						</DialogHeader>

						<FolderField
							value={parent}
							placeholder={t("panels.newProject.folderPlaceholder")}
							testId="new-project-parent"
							onPick={setParent}
							onError={setError}
						/>

						<input
							data-testid="new-project-name"
							value={name}
							placeholder={t("panels.newProject.namePlaceholder")}
							onChange={(event) => setName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && parent && trimmed) void create();
							}}
							className="w-full rounded-sm border border-control-border-default bg-control-bg px-12 py-8 text-text-default outline-none focus:border-control-border-active"
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
								{busy ? t("panels.newProject.creating") : t("panels.newProject.create")}
							</Button>
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
