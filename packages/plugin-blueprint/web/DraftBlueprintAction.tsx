import { RiPencilRuler2Line as PencilRuler } from "@remixicon/react";
import type { HostProjection, PluginWebContext } from "@thinkrail/plugin-api/web";
import { IconTooltip } from "@thinkrail/plugin-ui";
import { useState } from "react";
import type { blueprintContract } from "../contracts";
import { createBlueprintStartDialog } from "./BlueprintStartDialog";

function projectIdForWorkspace(host: HostProjection, workspaceId: string): string | null {
	for (const [projectId, workspaces] of Object.entries(host.workspaces)) {
		if (workspaces.some((workspace) => workspace.id === workspaceId)) return projectId;
	}
	return null;
}

export function createDraftBlueprintAction(ctx: PluginWebContext<typeof blueprintContract>) {
	const BlueprintStartDialog = createBlueprintStartDialog(ctx);

	return function DraftBlueprintAction({ workspaceId }: { workspaceId: string; groupId: string }) {
		const [open, setOpen] = useState(false);
		const projectId = ctx.useHost((host) => projectIdForWorkspace(host, workspaceId));
		if (!projectId) return null;
		return (
			<>
				<IconTooltip label="Draft a blueprint">
					<button
						type="button"
						data-testid="workspace-draft-blueprint"
						onClick={() => setOpen(true)}
						className="flex w-32 shrink-0 items-center justify-center border-border-default border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<PencilRuler className="size-14" />
					</button>
				</IconTooltip>
				{open ? <BlueprintStartDialog projectId={projectId} onOpenChange={setOpen} /> : null}
			</>
		);
	};
}

export function createDraftBlueprintProjectAction(ctx: PluginWebContext<typeof blueprintContract>) {
	const BlueprintStartDialog = createBlueprintStartDialog(ctx);

	return function DraftBlueprintProjectAction({ projectId }: { projectId: string }) {
		const [open, setOpen] = useState(false);
		return (
			<>
				<button
					type="button"
					data-testid="welcome-plugin-action"
					data-plugin-id="blueprint"
					onClick={() => setOpen(true)}
					className="relative flex h-[150px] w-[220px] flex-col items-start justify-between rounded-[var(--radius-sm)] border border-border-default bg-container-workspace-bg bg-clip-padding p-16 text-left transition-colors hover:border-primary-muted hover:bg-container-elevated-bg motion-safe:animate-reveal"
				>
					<span className="absolute top-12 right-12 rounded-full border border-primary-muted bg-primary-subtle bg-clip-padding px-8 py-2 tr-text-label-pill text-primary">
						new
					</span>
					<PencilRuler className="size-24 text-text-muted" />
					<span className="w-full">
						<span className="block tr-title-card text-text-default">Draft a blueprint</span>
						<span className="mt-2 block text-text-muted tr-text-metadata leading-snug">
							Describe an idea; get a spec whose decisions you can change.
						</span>
					</span>
				</button>
				{open ? <BlueprintStartDialog projectId={projectId} onOpenChange={setOpen} /> : null}
			</>
		);
	};
}
