import { RiBarChartBoxLine as VisualizationIcon } from "@remixicon/react";
import type { CompanionHost } from "@thinkrail/plugin-api/web";
import { definePluginWeb } from "@thinkrail/plugin-api/web";
import { createElement, useEffect } from "react";
import type { visualizeContract } from "../contracts";
import { useVisualizeStore } from "./store";
import { createVisualizationPane } from "./VisualizationPane";

export default definePluginWeb<typeof visualizeContract>({
	activate(ctx) {
		const { VisualizationPane } = createVisualizationPane(ctx);

		/** Only a terminal has no transcript of its own to show a `visualize` call again beside. */
		function useVisualizationAvailable(host: CompanionHost): boolean {
			useEffect(
				() =>
					ctx.subscribe(
						"changed",
						(payload) =>
							useVisualizeStore
								.getState()
								.setWorkspace(payload.workspaceId, payload.visualizations),
						{ workspaceId: host.workspaceId },
					),
				[host.workspaceId],
			);
			const revision = useVisualizeStore((s) =>
				host.kind === "terminal"
					? s.byWorkspace[host.workspaceId]?.[host.key]?.revision
					: undefined,
			);
			useEffect(() => {
				if (revision !== undefined)
					ctx.focusCompanion(
						{ kind: host.kind, workspaceId: host.workspaceId, key: host.key },
						"visualization",
					);
			}, [revision, host.kind, host.workspaceId, host.key]);
			return revision !== undefined;
		}

		function useVisualizationTitle(host: CompanionHost): string | null {
			return useVisualizeStore((s) =>
				host.kind === "terminal"
					? (s.byWorkspace[host.workspaceId]?.[host.key]?.title ?? null)
					: null,
			);
		}

		ctx.companion({
			kind: "visualization",
			hosts: ["terminal"],
			title: "Visualization",
			icon: (props) => createElement(VisualizationIcon, props),
			useAvailable: useVisualizationAvailable,
			useTitle: useVisualizationTitle,
			component: ({ host }) =>
				createElement(VisualizationPane, {
					workspaceId: host.workspaceId,
					terminalTabKey: host.key,
				}),
		});
	},
});
