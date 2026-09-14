import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import { VisualizationCard } from "@thinkrail/plugin-ui/visualization";
import { useCallback, useRef } from "react";
import type { visualizeContract } from "../contracts";
import { useVisualizeStore } from "./store";

export function createVisualizationPane(ctx: PluginWebContext<typeof visualizeContract>) {
	function VisualizationPane({
		workspaceId,
		terminalTabKey,
	}: {
		workspaceId: string;
		terminalTabKey: string;
	}) {
		const visualization = useVisualizeStore((s) => s.byWorkspace[workspaceId]?.[terminalTabKey]);

		const revision = visualization?.revision;
		const reported = useRef<number | null>(null);
		const report = useCallback(
			(error: string | null) => {
				if (revision === undefined || reported.current === revision) return;
				reported.current = revision;
				void ctx
					.request("report", {
						workspaceId,
						tabKey: terminalTabKey,
						revision,
						...(error === null ? {} : { error }),
					})
					.catch(() => {});
			},
			[revision, workspaceId, terminalTabKey],
		);

		if (!visualization) return null;
		return (
			<div data-testid="visualization-pane" className="flex h-full min-h-0 flex-col p-8">
				<VisualizationCard
					toolCallId={`visualization-${terminalTabKey}-${visualization.revision}`}
					toolName="visualize"
					args={visualization.args}
					result={null}
					status="done"
					streaming={false}
					interactive
					onRender={report}
				/>
			</div>
		);
	}

	return { VisualizationPane };
}
