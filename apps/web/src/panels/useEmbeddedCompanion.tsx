import {
	RiBookOpenLine as BlueprintIcon,
	RiBarChartBoxLine as VisualizationIcon,
} from "@remixicon/react";
import { lazy, type ReactNode, Suspense, useEffect } from "react";
import type { EmbeddedCompanion } from "@/components/EmbeddedSplit";
import { type EmbeddedPaneKind, useAppStore } from "@/store";

const BlueprintPane = lazy(() =>
	import("./BlueprintView").then((module) => ({ default: module.BlueprintPane })),
);
const VisualizationPane = lazy(() => import("./VisualizationPane"));

export interface EmbeddedCompanionState {
	direction: "horizontal" | "vertical";
	companion: EmbeddedCompanion | null;
	chips: ReactNode;
}

/**
 * What a terminal carries beside itself: the blueprint it authors, or the visualization the agent in it
 * drew. One at a time, the newest leading; a closed one folds into a chip. See panels/SPEC.md.
 */
export function useTerminalCompanion(
	workspaceId: string,
	tabKey: string,
	hostKey: string,
): EmbeddedCompanionState {
	const direction = useAppStore((s) => s.localLayoutPreferences.defaultPaneDirection);
	const entry = useAppStore((s) => s.embeddedPanes[workspaceId]?.[hostKey]);
	const visualization = useAppStore((s) => s.visualizationsByTerminal[workspaceId]?.[tabKey]);
	const blueprint = useAppStore((s) => s.blueprintByWorkspace[workspaceId]);
	const authorsBlueprint =
		blueprint?.author?.kind === "terminal" && blueprint.author.tabKey === tabKey;

	useEffect(() => {
		if (!authorsBlueprint) return;
		useAppStore.getState().focusEmbeddedPane(workspaceId, hostKey, "blueprint");
	}, [authorsBlueprint, workspaceId, hostKey]);

	const available: Record<EmbeddedPaneKind, boolean> = {
		blueprint: authorsBlueprint,
		visualization: visualization !== undefined,
	};
	const order: EmbeddedPaneKind[] =
		entry?.focus === "visualization"
			? ["visualization", "blueprint"]
			: ["blueprint", "visualization"];
	const shown = order.find((kind) => available[kind] && entry?.hidden?.[kind] !== true) ?? null;
	const hide = (kind: EmbeddedPaneKind) =>
		useAppStore.getState().setEmbeddedPaneHidden(workspaceId, hostKey, kind, true);

	const companion: EmbeddedCompanion | null =
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
						title: visualization.title,
						content: (
							<Suspense fallback={null}>
								<VisualizationPane workspaceId={workspaceId} terminalTabKey={tabKey} />
							</Suspense>
						),
						onClose: () => hide("visualization"),
					}
				: null;

	const folded = (["blueprint", "visualization"] as const).filter(
		(kind) => available[kind] && kind !== shown,
	);
	const chips =
		folded.length === 0 ? null : (
			<div className="absolute right-12 bottom-8 z-20 flex items-center gap-4">
				{folded.map((kind) => (
					<button
						key={kind}
						type="button"
						data-testid="terminal-embedded-chip"
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
							{kind === "blueprint" ? "Blueprint" : (visualization?.title ?? "Visualization")}
						</span>
					</button>
				))}
			</div>
		);

	return { direction, companion, chips };
}
