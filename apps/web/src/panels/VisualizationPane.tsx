import { useCallback, useEffect, useRef } from "react";
import { VisualizationCard } from "../chat/tools/visualize/VisualizationCard";
import { LoadingRegion } from "../components/Skeleton";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

export default function VisualizationPane({
	workspaceId,
	terminalTabKey,
}: {
	workspaceId: string;
	terminalTabKey: string;
}) {
	const visualization = useAppStore(
		(s) => s.visualizationsByTerminal[workspaceId]?.[terminalTabKey],
	);

	useEffect(() => {
		if (visualization) return;
		let stale = false;
		getTransport()
			.request("visualization.get", { workspaceId, tabKey: terminalTabKey })
			.then((fetched) => {
				if (!stale && fetched) {
					useAppStore.getState().setVisualization(workspaceId, terminalTabKey, fetched);
				}
			})
			.catch(() => {});
		return () => {
			stale = true;
		};
	}, [visualization, workspaceId, terminalTabKey]);

	const revision = visualization?.revision;
	const reported = useRef<number | null>(null);
	const report = useCallback(
		(error: string | null) => {
			if (revision === undefined || reported.current === revision) return;
			reported.current = revision;
			void getTransport()
				.request("visualization.report", {
					workspaceId,
					tabKey: terminalTabKey,
					revision,
					...(error === null ? {} : { error }),
				})
				.catch(() => {});
		},
		[revision, workspaceId, terminalTabKey],
	);

	if (!visualization) return <LoadingRegion rows={8} className="h-full p-12" />;
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
