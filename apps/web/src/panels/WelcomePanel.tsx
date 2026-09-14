import {
	RiFolderOpenLine as FolderOpen,
	RiFolderAddLine as FolderPlus,
	RiHome2Line as House,
	type RemixiconComponentType as LucideIcon,
	RiRocketLine as Rocket,
} from "@remixicon/react";
import type { Workspace } from "@thinkrail/contracts";
import { type ComponentPropsWithoutRef, forwardRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME } from "../constants/branding";
import { selectProjectActions, usePluginRegistry } from "../plugins/registry";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { AddProjectMenu } from "./AddProjectMenu";
import { CloneProjectDialog } from "./CloneProjectDialog";
import { enterDefaultWorkspace } from "./defaultWorkspace";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { ProjectSkillsNotice } from "./ProjectSkillsNotice";
import { ProviderWarningBanner } from "./ProviderWarningBanner";
import { useOpenProject } from "./useOpenProject";

export function WelcomePanel() {
	const projects = useAppStore((s) => s.projects);
	const recentProjects = useAppStore((s) => s.recentProjects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const projectActions = usePluginRegistry(selectProjectActions);
	const [dialog, setDialog] = useState<{
		projectId: string;
		prompt: string;
		note?: string;
	} | null>(null);
	const [newProject, setNewProject] = useState(false);
	const [cloneProject, setCloneProject] = useState(false);

	const project = projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;

	const { openProject, pickAndOpen, enterHostPath, dialogs } = useOpenProject((opened) =>
		useAppStore.getState().selectProject(opened.id, { reveal: true }),
	);

	const onWorkspaceCreated = async (ws: Workspace) => {
		useAppStore
			.getState()
			.setWorkspaces(
				ws.projectId,
				await getTransport().request("workspace.list", { projectId: ws.projectId }),
			);
	};

	const noProjects = project == null;

	const newProjectCard = () => (
		<Card
			icon={FolderPlus}
			title="New project"
			subtitle="Create a folder, start a git repo in it, and open it here."
			onClick={() => setNewProject(true)}
		/>
	);

	const projectFolderCard = (projectId: string) => (
		<Card
			icon={House}
			title="Work in project folder"
			subtitle="Chats, changes, and terminals run directly in your project folder — no isolation."
			onClick={() => void enterDefaultWorkspace(projectId)}
			className="motion-safe:animate-reveal"
		/>
	);

	const openProjectCard = () => (
		<AddProjectMenu
			recentProjects={recentProjects}
			onOpen={() => void pickAndOpen()}
			onEnterHostPath={enterHostPath}
			onNew={() => setNewProject(true)}
			onClone={() => setCloneProject(true)}
			onOpenRecent={(path) => void openProject(path)}
			align="start"
		>
			<Card
				cta
				primary
				icon={FolderOpen}
				title="Open project"
				subtitle="Choose a local git repository to work in."
			/>
		</AddProjectMenu>
	);

	return (
		<div
			data-testid="welcome"
			className="flex h-full min-h-0 flex-col items-center justify-center overflow-auto px-24 py-24 text-center"
		>
			<h1
				data-testid="welcome-title"
				className="tr-brand-hero max-w-[640px] break-words text-primary"
			>
				{project ? project.name : PRODUCT_NAME}
			</h1>

			<ProviderWarningBanner />
			{project ? <ProjectSkillsNotice projectId={project.id} /> : null}

			<div className="mt-24 flex flex-wrap justify-center gap-12">
				{noProjects ? (
					<>
						{openProjectCard()}
						{newProjectCard()}
					</>
				) : (
					<>
						<Card
							cta
							primary
							icon={Rocket}
							title="Start building"
							subtitle={
								project.hasGit === false
									? "Pair with the agent in the project folder — no git, so no worktree to cut."
									: "Cut an isolated worktree + branch, then pair with the agent to build it."
							}
							onClick={() => setDialog({ projectId: project.id, prompt: "" })}
							className="motion-safe:animate-reveal"
						/>
						{projectFolderCard(project.id)}
						{projectActions.map((action) => (
							<action.value.component key={action.pluginId} projectId={project.id} />
						))}
					</>
				)}
			</div>

			{newProject ? (
				<NewProjectDialog
					onOpenChange={setNewProject}
					onCreated={(created) =>
						useAppStore.getState().selectProject(created.id, { reveal: true })
					}
				/>
			) : null}
			{cloneProject ? (
				<CloneProjectDialog
					onOpenChange={setCloneProject}
					onCloned={(cloned) => useAppStore.getState().selectProject(cloned.id, { reveal: true })}
				/>
			) : null}
			{dialog ? (
				<NewWorkspaceDialog
					open
					projectId={dialog.projectId}
					initialPrompt={dialog.prompt}
					{...(dialog.note !== undefined ? { promptNote: dialog.note } : {})}
					onOpenChange={(o) => {
						if (!o) setDialog(null);
					}}
					onCreated={(ws) => void onWorkspaceCreated(ws)}
				/>
			) : null}
			{dialogs}
		</div>
	);
}

type CardProps = {
	cta?: boolean;
	primary?: boolean;
	icon: LucideIcon;
	title: string;
	subtitle: string;
	tag?: string;
} & ComponentPropsWithoutRef<"button">;

const Card = forwardRef<HTMLButtonElement, CardProps>(function Card(
	{ cta, primary, icon: Icon, title, subtitle, tag, className, ...rest },
	ref,
) {
	return (
		<button
			ref={ref}
			type="button"
			data-testid={cta ? "welcome-cta" : "welcome-action"}
			{...rest}
			className={cn(
				"relative flex h-[150px] w-[220px] flex-col items-start justify-between rounded-[var(--radius-sm)] border bg-clip-padding p-16 text-left transition-colors",
				primary
					? "border-primary-muted bg-primary-subtle hover:bg-primary-soft"
					: "border-border-default bg-container-workspace-bg hover:border-primary-muted hover:bg-container-elevated-bg",
				className,
			)}
		>
			{tag ? (
				<span className="absolute top-12 right-12 rounded-full border border-primary-muted bg-clip-padding bg-primary-subtle px-8 py-2 tr-text-label-pill text-primary">
					{tag}
				</span>
			) : null}
			<Icon className={cn("size-24", primary ? "text-primary" : "text-text-muted")} />
			<span className="w-full">
				<span className="block tr-title-card text-text-default">{title}</span>
				<span className="mt-2 block text-text-muted tr-text-metadata leading-snug">{subtitle}</span>
			</span>
		</button>
	);
});
