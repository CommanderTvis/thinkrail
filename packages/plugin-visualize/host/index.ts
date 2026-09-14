import { definePluginHost } from "@thinkrail/plugin-api/host";
import type { VisualizeParams } from "pi-visualize/schema";
import { visualizeContract } from "../contracts";
import { manifest } from "../manifest";
import {
	adoptVisualizationForSession,
	forgetVisualizations,
	reportVisualizationRender,
	runVisualizeTool,
	setAgentSessionLookup,
	setVisualizationPublisher,
	setVisualizationStore,
	VISUALIZE_TOOL_DESCRIPTION,
	VisualizeSchema,
	visualizationsForWorkspace,
} from "./store";

export default definePluginHost({
	manifest,
	contract: visualizeContract,
	activate(ctx) {
		setVisualizationStore({
			read: () => ctx.readState("visualizations", {}),
			write: (value) => ctx.writeState("visualizations", value),
		});
		setVisualizationPublisher((payload) => ctx.publish("changed", payload));
		setAgentSessionLookup((workspaceId, tabKey) => {
			const record = ctx.agentRecord({ workspaceId, tabKey });
			return record?.sessionId ?? null;
		});

		ctx.method("report", (params) => {
			reportVisualizationRender(
				params.workspaceId,
				params.tabKey,
				params.revision,
				params.error ?? null,
			);
			return { ok: true as const };
		});

		ctx.method("get", (params) => ({
			workspaceId: params.workspaceId,
			visualizations: visualizationsForWorkspace(params.workspaceId),
		}));

		ctx.onTerminal((event) => {
			if (event.kind !== "agentChanged" || !event.record?.sessionId) return;
			adoptVisualizationForSession(
				event.terminal.workspaceId,
				event.terminal.tabKey,
				event.record.sessionId,
			);
		});

		ctx.onWorkspace((event) => {
			if (event.kind === "removed") forgetVisualizations(event.id);
		});

		ctx.tool({
			name: "visualize",
			label: "Visualize",
			description: VISUALIZE_TOOL_DESCRIPTION,
			parameters: VisualizeSchema,
			surfaces: ["mcp"],
			async run(params: VisualizeParams, toolCtx) {
				const terminal = toolCtx.terminal;
				if (!terminal)
					return { text: "visualize is only available from a terminal.", isError: true };
				return runVisualizeTool(terminal, params);
			},
		});

		return () => {
			setVisualizationPublisher(null);
			setAgentSessionLookup(null);
		};
	},
});
