import { afterEach, expect, test } from "bun:test";
import type { VisualizationPush } from "@thinkrail/contracts";
import {
	forgetVisualizations,
	getVisualization,
	recordVisualization,
	resetVisualizations,
	setVisualizationPublisher,
	visualizeMcpTool,
} from "./visualize";

afterEach(() => {
	resetVisualizations();
	setVisualizationPublisher(null);
});

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

test("every rewrite is pushed with the terminal it belongs to", () => {
	const pushes: VisualizationPush[] = [];
	setVisualizationPublisher((push) => pushes.push(push));
	recordVisualization("w1", "t1", { type: "diagram", mermaid: "graph TD;A;" });
	recordVisualization("w1", "t2", { type: "comparison", options: [{ name: "A" }] });
	expect(pushes.map((push) => push.tabKey)).toEqual(["t1", "t2"]);
	expect(pushes[1]?.visualization.title).toBe("Comparison");
});

test("the MCP tool validates before it draws, and says how to update", () => {
	const tool = visualizeMcpTool({ workspaceId: "w1", tabKey: "t1" });
	expect(tool.name).toBe("visualize");

	const bad = tool.call({ type: "diagram" });
	expect(bad.isError).toBe(true);
	expect(bad.text).toContain("mermaid");

	const drawn = tool.call({ type: "diagram", title: "Wired", mermaid: "graph TD;A-->B;" });
	expect(drawn.isError).toBeUndefined();
	expect(drawn.text).toContain('Rendered "Wired" in ThinkRail (revision 1)');
	expect(getVisualization("w1", "t1")?.title).toBe("Wired");

	const shapeless = tool.call({ mermaid: "graph TD;A;" });
	expect(shapeless.isError).toBe(true);
});

test("forgetting a workspace drops its terminals' views and no other's", () => {
	recordVisualization("w1", "t1", { type: "diagram", mermaid: "graph TD;A;" });
	recordVisualization("w2", "t1", { type: "diagram", mermaid: "graph TD;B;" });
	forgetVisualizations("w1");
	expect(getVisualization("w1", "t1")).toBeNull();
	expect(getVisualization("w2", "t1")?.revision).toBe(1);
});
