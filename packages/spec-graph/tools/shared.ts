import type { Static, TObject } from "typebox";
import { SpecIndex, type SpecType } from "../core/index.ts";

const indexes = new Map<string, SpecIndex>();

export function getIndex(root: string): SpecIndex {
	let index = indexes.get(root);
	if (!index) {
		index = new SpecIndex(root);
		indexes.set(root, index);
	}
	return index;
}

export interface SpecToolOutcome<T> {
	text: string;
	details: T;
}

export interface SpecToolDef<P extends TObject, T> {
	name: string;
	label: string;
	description: string;
	promptSnippet: string;
	parameters: P;
	run(params: Static<P>, cwd: string): Promise<SpecToolOutcome<T>> | SpecToolOutcome<T>;
}

export function defineSpecTool<P extends TObject, T>(tool: SpecToolDef<P, T>): SpecToolDef<P, T> {
	return tool;
}

export function textResult<T>(text: string, details: T): SpecToolOutcome<T> {
	return { text, details };
}

export function errorResult(message: string): SpecToolOutcome<{ error: string }> {
	return { text: `Error: ${message}`, details: { error: message } };
}

const SCAFFOLD_HEADINGS: Record<SpecType, string[]> = {
	"module-design": ["Responsibility", "Boundary"],
	"submodule-design": ["Responsibility", "Boundary"],
	"architecture-design": ["Drivers", "Decisions", "Invariants", "Out of scope"],
	"goal-and-requirements": ["Goal", "Scope"],
	"task-spec": ["Purpose", "Open items"],
};

export function scaffoldBody(type: SpecType): string {
	const headings = SCAFFOLD_HEADINGS[type];
	if (!headings || headings.length === 0) return "";
	return `${headings.map((h) => `## ${h}\n`).join("\n")}`;
}
