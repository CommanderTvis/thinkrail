import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import type { specDialectContract } from "../contracts";
import { useSpecStore } from "./store";

type Ctx = PluginWebContext<typeof specDialectContract>;

/** Collapses concurrent calls for the same workspace + fs revision into one request. */
const inFlight = new Set<string>();

export function loadWorkspaceSpecs(ctx: Ctx, workspaceId: string): Promise<void> {
	return ctx
		.request("graph", { workspaceId })
		.then((result) => {
			useSpecStore.getState().setWorkspaceSpecs(workspaceId, result.nodes);
			useSpecStore.getState().setWorkspaceFailed(workspaceId, false);
		})
		.catch(() => {
			useSpecStore.getState().setWorkspaceFailed(workspaceId, true);
		});
}

export function syncWorkspaceSpecs(ctx: Ctx, workspaceId: string, revision: number): void {
	const key = `${workspaceId}#${revision}`;
	if (inFlight.has(key)) return;
	inFlight.add(key);
	void loadWorkspaceSpecs(ctx, workspaceId).finally(() => inFlight.delete(key));
}
