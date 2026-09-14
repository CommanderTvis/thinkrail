import { expect, test } from "bun:test";
import type { PluginHostContext } from "@thinkrail/plugin-api/host";
import type { branchGraphContract } from "../contracts";
import host from "./index";

function fakeContext(options: {
	projects?: { id: string; path: string }[];
	gitResult?: { ok: boolean; out?: string; err?: string; failure?: string };
}) {
	const methods = new Map<string, (params: unknown) => Promise<unknown>>();
	const ctx = {
		projects: () => options.projects ?? [{ id: "p1", path: "/repo" }],
		workspaces: () => [],
		git: async (_cwd: string, _args: readonly string[]) =>
			options.gitResult ?? { ok: true, out: "patch-output", err: "" },
		method: (name: string, handler: (params: unknown) => Promise<unknown>) => {
			methods.set(name, handler);
		},
	} as unknown as PluginHostContext<typeof branchGraphContract>;

	host.activate(ctx);
	return { methods };
}

test("patch runs git format-patch and returns the output", async () => {
	const { methods } = fakeContext({
		gitResult: { ok: true, out: "From abc Mon Sep 17 00:00:00 2001\n..." },
	});
	const handler = methods.get("patch");
	expect(handler).toBeDefined();
	if (!handler) throw new Error("Missing patch handler");
	const result = await handler({ projectId: "p1", sha: "abc" });
	expect(result).toEqual({ patch: "From abc Mon Sep 17 00:00:00 2001\n..." });
});

test("patch fails if git returns failure", async () => {
	const { methods } = fakeContext({
		gitResult: { ok: false, err: "fatal: bad object", failure: "exit 128" },
	});
	const handler = methods.get("patch");
	expect(handler).toBeDefined();
	if (!handler) throw new Error("Missing patch handler");
	await expect(handler({ projectId: "p1", sha: "bad" })).rejects.toThrow(
		"Could not generate patch",
	);
});

test("patch fails for unknown project", async () => {
	const { methods } = fakeContext({ projects: [] });
	const handler = methods.get("patch");
	expect(handler).toBeDefined();
	if (!handler) throw new Error("Missing patch handler");
	await expect(handler({ projectId: "unknown", sha: "abc" })).rejects.toThrow("Unknown project");
});
