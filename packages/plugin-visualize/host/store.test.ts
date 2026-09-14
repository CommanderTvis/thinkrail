import { afterEach, expect, test } from "bun:test";
import type { TerminalVisualization, VisualizationsChangedPayload } from "../contracts";
import {
	adoptVisualizationForSession,
	forgetVisualizations,
	getVisualization,
	recordVisualization,
	reportVisualizationRender,
	resetVisualizations,
	runVisualizeTool,
	setAgentSessionLookup,
	setVisualizationPublisher,
	setVisualizationStore,
	visualizationsForWorkspace,
} from "./store";

afterEach(() => {
	resetVisualizations();
	setVisualizationPublisher(null);
	setAgentSessionLookup(null);
	setVisualizationStore({ read: () => ({}), write: () => {} });
	forgetVisualizations("w1");
	forgetVisualizations("w2");
});

function memoryStore() {
	let value: Record<string, Record<string, TerminalVisualization>> = {};
	return {
		read: () => value,
		write: (next: Record<string, Record<string, TerminalVisualization>>) => {
			value = next;
		},
	};
}

test("a recorded visualization is retrievable per terminal, and revisions count rewrites", () => {
	const first = recordVisualization("w1", "t1", { type: "diagram", mermaid: "graph TD;A-->B;" });
	expect(first.revision).toBe(1);
	expect(first.title).toBe("Diagram");

	const second = recordVisualization("w1", "t1", {
		type: "diagram",
		title: "Flow",
		mermaid: "graph TD;A-->C;",
	});
	expect(second.revision).toBe(2);
	expect(second.title).toBe("Flow");

	expect(getVisualization("w1", "t1")?.revision).toBe(2);
	expect(getVisualization("w1", "t2")).toBeNull();
	expect(getVisualization("w2", "t1")).toBeNull();
});

test("every rewrite is published as the whole workspace's map", () => {
	const pushes: VisualizationsChangedPayload[] = [];
	setVisualizationPublisher((push) => pushes.push(push));
	recordVisualization("w1", "t1", { type: "diagram", mermaid: "graph TD;A;" });
	recordVisualization("w1", "t2", { type: "comparison", options: [{ name: "A" }] });
	expect(pushes.map((push) => Object.keys(push.visualizations))).toEqual([["t1"], ["t1", "t2"]]);
	expect(pushes[1]?.visualizations.t2?.title).toBe("Comparison");
});

test("visualizationsForWorkspace only enumerates that workspace's terminals", () => {
	recordVisualization("w1", "t1", { type: "diagram", mermaid: "graph TD;A;" });
	recordVisualization("w2", "t1", { type: "diagram", mermaid: "graph TD;B;" });
	expect(Object.keys(visualizationsForWorkspace("w1"))).toEqual(["t1"]);
});

test("the tool validates before it draws, and says how to update", async () => {
	const bad = await runVisualizeTool({ workspaceId: "w1", tabKey: "t1" }, { type: "diagram" });
	expect(bad.isError).toBe(true);
	expect(bad.text).toContain("mermaid");

	const drawing = runVisualizeTool(
		{ workspaceId: "w1", tabKey: "t1" },
		{ type: "diagram", title: "Wired", mermaid: "graph TD;A-->B;" },
	);
	reportVisualizationRender("w1", "t1", 1, null);
	const drawn = await drawing;
	expect(drawn.isError).toBeUndefined();
	expect(drawn.text).toContain('Rendered "Wired" in ThinkRail (revision 1)');
	expect(getVisualization("w1", "t1")?.title).toBe("Wired");
});

test("a diagram the renderer refuses comes back as a tool error, and the last good one stands", async () => {
	const good = runVisualizeTool(
		{ workspaceId: "w1", tabKey: "t1" },
		{ type: "diagram", title: "Good", mermaid: "graph TD;A-->B;" },
	);
	reportVisualizationRender("w1", "t1", 1, null);
	await good;

	const drawing = runVisualizeTool(
		{ workspaceId: "w1", tabKey: "t1" },
		{ type: "diagram", title: "Broken", mermaid: "graph TD;A--" },
	);
	reportVisualizationRender("w1", "t1", 2, "Parse error on line 1");
	const answer = await drawing;
	expect(answer.isError).toBe(true);
	expect(answer.text).toContain("Parse error on line 1");
	expect(answer.text).toContain("call visualize again");
	expect(getVisualization("w1", "t1")?.title).toBe("Good");

	const second = runVisualizeTool(
		{ workspaceId: "w1", tabKey: "t1" },
		{ type: "diagram", title: "Better", mermaid: "graph TD;A-->B;" },
	);
	reportVisualizationRender("w1", "t1", 2, null);
	expect((await second).isError).toBeUndefined();
	expect(getVisualization("w1", "t1")?.title).toBe("Better");
});

test("forgetting a workspace drops its terminals' views and no other's", () => {
	recordVisualization("w1", "t1", { type: "diagram", mermaid: "graph TD;A;" });
	recordVisualization("w2", "t1", { type: "diagram", mermaid: "graph TD;B;" });
	forgetVisualizations("w1");
	expect(getVisualization("w1", "t1")).toBeNull();
	expect(getVisualization("w2", "t1")?.revision).toBe(1);
});

test("a resumed conversation reclaims its drawing in whatever tab it lands in", () => {
	setVisualizationStore(memoryStore());
	setAgentSessionLookup((_workspaceId, tabKey) => (tabKey === "t1" ? "sess-1" : null));
	const pushes: VisualizationsChangedPayload[] = [];
	recordVisualization("w1", "t1", { type: "diagram", title: "Kept", mermaid: "graph TD;A;" });
	setVisualizationPublisher((push) => pushes.push(push));

	const adopted = adoptVisualizationForSession("w1", "t9", "sess-1");
	expect(adopted?.title).toBe("Kept");
	expect(getVisualization("w1", "t9")?.title).toBe("Kept");
	expect(pushes).toHaveLength(1);

	expect(adoptVisualizationForSession("w1", "t9", "sess-1")).toBeNull();
	expect(pushes).toHaveLength(1);

	expect(adoptVisualizationForSession("w1", "t9", "sess-unknown")).toBeNull();
});

test("a workspace's drawings are forgotten with it, on disk as well as in memory", () => {
	setVisualizationStore(memoryStore());
	setAgentSessionLookup(() => "sess-2");
	recordVisualization("w2", "t1", { type: "diagram", mermaid: "graph TD;B;" });
	expect(adoptVisualizationForSession("w2", "t2", "sess-2")?.revision).toBe(1);
	forgetVisualizations("w2");
	expect(getVisualization("w2", "t1")).toBeNull();
	expect(adoptVisualizationForSession("w2", "t3", "sess-2")).toBeNull();
});
