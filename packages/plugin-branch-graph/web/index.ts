import { definePluginWeb } from "@thinkrail/plugin-api/web";
import type { branchGraphContract } from "../contracts";
import { GRAPH_TOOL } from "../manifest";
import { createGraphPanel } from "./GraphPanel";

export default definePluginWeb<typeof branchGraphContract>({
	activate(ctx) {
		ctx.sideTool({
			tool: GRAPH_TOOL,
			component: createGraphPanel(ctx),
		});
	},
});
