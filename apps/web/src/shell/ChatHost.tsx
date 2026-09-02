import {
	RiBookOpenLine as BlueprintIcon,
	RiBarChartBoxLine as VisualizationIcon,
} from "@remixicon/react";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { EmbeddedSplit } from "@/components/EmbeddedSplit";
import { latestVisualization } from "../chat/tools/visualize/latest";
import { VisualizationCard } from "../chat/tools/visualize/VisualizationCard";
import { type EmbeddedPaneKind, embeddedHostKey, useAppStore } from "../store";

const ChatView = lazy(() => import("../chat/ChatView"));
const BlueprintPane = lazy(() =>
	import("../panels/BlueprintView").then((module) => ({ default: module.BlueprintPane })),
);

/**
 * A chat with company: the blueprint it authors, or its latest visualize call, live in an embedded
 * pane beside the transcript. Composed here because chat may not import panels — see chat/SPEC.md.
 */
export function ChatHost({
	workspaceId,
	sessionId,
	onOpenFile,
}: {
	workspaceId: string;
	sessionId: string;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	const paneDirection = useAppStore((s) => s.localLayoutPreferences.defaultPaneDirection);
	const hostKey = embeddedHostKey("chat", sessionId);
	const paneEntry = useAppStore((s) => s.embeddedPanes[workspaceId]?.[hostKey]);
	const blueprint = useAppStore((s) => s.blueprintByWorkspace[workspaceId]);
	const authorsBlueprint =
		blueprint?.author?.kind === "chat" && blueprint.author.sessionId === sessionId;
	const turns = useAppStore((s) => s.sessions[sessionId]?.turns);
	const visualization = useMemo(() => latestVisualization(turns ?? []), [turns]);

	useEffect(() => {
		if (!visualization) return;
		useAppStore.getState().focusEmbeddedPane(workspaceId, hostKey, "visualization");
	}, [visualization, workspaceId, hostKey]);

	const available: Record<EmbeddedPaneKind, boolean> = {
		blueprint: authorsBlueprint,
		visualization: visualization !== null,
	};
	const order: EmbeddedPaneKind[] =
		paneEntry?.focus === "visualization"
			? ["visualization", "blueprint"]
			: ["blueprint", "visualization"];
	const shown = order.find((kind) => available[kind] && paneEntry?.hidden?.[kind] !== true) ?? null;
	const hide = (kind: EmbeddedPaneKind) =>
		useAppStore.getState().setEmbeddedPaneHidden(workspaceId, hostKey, kind, true);

	const companion =
		shown === "blueprint"
			? {
					title: "Blueprint",
					content: (
						<Suspense fallback={null}>
							<BlueprintPane workspaceId={workspaceId} />
						</Suspense>
					),
					onClose: () => hide("blueprint"),
				}
			: shown === "visualization" && visualization
				? {
						title:
							typeof visualization.args.title === "string" && visualization.args.title !== ""
								? visualization.args.title
								: "Visualization",
						content: (
							<div className="flex h-full min-h-0 flex-col p-8">
								<VisualizationCard
									toolCallId={visualization.toolCallId}
									toolName="visualize"
									args={visualization.args}
									result={null}
									status="done"
									streaming={false}
									interactive
								/>
							</div>
						),
						onClose: () => hide("visualization"),
					}
				: null;
	const chips = (["blueprint", "visualization"] as const).filter(
		(kind) => available[kind] && kind !== shown,
	);

	return (
		<EmbeddedSplit direction={paneDirection} companion={companion}>
			<div className="relative h-full min-h-0">
				<ChatView sessionId={sessionId} workspaceId={workspaceId} onOpenFile={onOpenFile} />
				{chips.length > 0 ? (
					<div className="absolute top-44 right-12 z-20 flex items-center gap-4">
						{chips.map((kind) => (
							<button
								key={kind}
								type="button"
								data-testid="chat-embedded-chip"
								data-kind={kind}
								title={kind === "blueprint" ? "Show the blueprint" : "Show the visualization"}
								onClick={() => useAppStore.getState().focusEmbeddedPane(workspaceId, hostKey, kind)}
								className="flex shrink-0 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] bg-container-elevated-bg px-4 tr-text-label-pill text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
							>
								{kind === "blueprint" ? (
									<BlueprintIcon className="size-12 shrink-0" />
								) : (
									<VisualizationIcon className="size-12 shrink-0" />
								)}
								<span className="max-w-[10rem] truncate">
									{kind === "blueprint"
										? "Blueprint"
										: typeof visualization?.args.title === "string" && visualization.args.title
											? visualization.args.title
											: "Visualization"}
								</span>
							</button>
						))}
					</div>
				) : null}
			</div>
		</EmbeddedSplit>
	);
}
