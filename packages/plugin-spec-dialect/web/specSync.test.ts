import { expect, test } from "bun:test";
import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import type { specDialectContract } from "../contracts";
import { loadWorkspaceSpecs, syncWorkspaceSpecs } from "./specSync";
import { useSpecStore } from "./store";

type Ctx = PluginWebContext<typeof specDialectContract>;

function fakeCtx(request: Ctx["request"]): Ctx {
	return { request } as unknown as Ctx;
}

test("loadWorkspaceSpecs populates the store on success and clears any prior failure", () => {
	useSpecStore.setState({ specsByWorkspace: {}, failedByWorkspace: { w1: true } });
	const ctx = fakeCtx(async () => ({ nodes: [] }) as never);

	return loadWorkspaceSpecs(ctx, "w1").then(() => {
		expect(useSpecStore.getState().specsByWorkspace.w1).toEqual([]);
		expect(useSpecStore.getState().failedByWorkspace.w1).toBe(false);
	});
});

test("loadWorkspaceSpecs marks the workspace failed when the request rejects", () => {
	useSpecStore.setState({ specsByWorkspace: {}, failedByWorkspace: {} });
	const ctx = fakeCtx(async () => {
		throw new Error("boom");
	});

	return loadWorkspaceSpecs(ctx, "w1").then(() => {
		expect(useSpecStore.getState().failedByWorkspace.w1).toBe(true);
	});
});

test("syncWorkspaceSpecs collapses concurrent calls for the same workspace + revision into one request", async () => {
	useSpecStore.setState({ specsByWorkspace: {}, failedByWorkspace: {} });
	let calls = 0;
	const ctx = fakeCtx(async () => {
		calls++;
		return { nodes: [] } as never;
	});

	syncWorkspaceSpecs(ctx, "w1", 1);
	syncWorkspaceSpecs(ctx, "w1", 1);
	await Promise.resolve();
	await Promise.resolve();

	expect(calls).toBe(1);
});

test("syncWorkspaceSpecs issues a fresh request once the revision advances", async () => {
	useSpecStore.setState({ specsByWorkspace: {}, failedByWorkspace: {} });
	let calls = 0;
	const ctx = fakeCtx(async () => {
		calls++;
		return { nodes: [] } as never;
	});

	syncWorkspaceSpecs(ctx, "w1", 1);
	await Promise.resolve();
	await Promise.resolve();
	syncWorkspaceSpecs(ctx, "w1", 2);
	await Promise.resolve();
	await Promise.resolve();

	expect(calls).toBe(2);
});
