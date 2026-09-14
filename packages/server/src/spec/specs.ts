import { SpecIndex } from "pi-spec-graph/core";

const projectIndexes = new Map<string, SpecIndex>();

export function projectHasSpecs(root: string): boolean {
	let index = projectIndexes.get(root);
	if (!index) {
		index = new SpecIndex(root);
		projectIndexes.set(root, index);
	}
	try {
		for (const node of index.graph().nodes.values()) {
			if (node.type !== "task-spec") return true;
		}
		return false;
	} catch {
		return false;
	}
}
