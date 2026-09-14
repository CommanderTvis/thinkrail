import { create } from "zustand";
import type { SpecGraphNode } from "../contracts";

export interface SelectSpecRequest {
	workspaceId: string;
	path: string;
}

interface SpecStoreState {
	specsByWorkspace: Record<string, SpecGraphNode[]>;
	failedByWorkspace: Record<string, boolean>;
	selectRequest: SelectSpecRequest | null;
	setWorkspaceSpecs: (workspaceId: string, nodes: SpecGraphNode[]) => void;
	setWorkspaceFailed: (workspaceId: string, failed: boolean) => void;
	requestSelect: (workspaceId: string, path: string) => void;
	clearSelectRequest: () => void;
}

function shallowEqualArrays(a: readonly unknown[], b: readonly unknown[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameNode(a: SpecGraphNode, b: SpecGraphNode): boolean {
	return (
		a.id === b.id &&
		a.type === b.type &&
		a.title === b.title &&
		a.status === b.status &&
		a.path === b.path &&
		a.parent === b.parent &&
		shallowEqualArrays(a.dependsOn, b.dependsOn) &&
		shallowEqualArrays(a.references, b.references) &&
		shallowEqualArrays(a.implements, b.implements) &&
		shallowEqualArrays(a.tags, b.tags)
	);
}

/** Avoids invalidating memoized selectors over an unchanged re-read — see SPEC.md. */
export function sameSpecGraph(prev: SpecGraphNode[] | undefined, next: SpecGraphNode[]): boolean {
	if (!prev || prev.length !== next.length) return false;
	return prev.every((node, i) => {
		const candidate = next[i];
		return candidate !== undefined && sameNode(node, candidate);
	});
}

export const useSpecStore = create<SpecStoreState>((set) => ({
	specsByWorkspace: {},
	failedByWorkspace: {},
	selectRequest: null,
	setWorkspaceSpecs: (workspaceId, nodes) =>
		set((s) =>
			sameSpecGraph(s.specsByWorkspace[workspaceId], nodes)
				? {}
				: { specsByWorkspace: { ...s.specsByWorkspace, [workspaceId]: nodes } },
		),
	setWorkspaceFailed: (workspaceId, failed) =>
		set((s) =>
			(s.failedByWorkspace[workspaceId] ?? false) === failed
				? {}
				: { failedByWorkspace: { ...s.failedByWorkspace, [workspaceId]: failed } },
		),
	requestSelect: (workspaceId, path) => set({ selectRequest: { workspaceId, path } }),
	clearSelectRequest: () => set({ selectRequest: null }),
}));

export function evictWorkspace(workspaceId: string): void {
	useSpecStore.setState((s) => {
		if (!(workspaceId in s.specsByWorkspace) && !(workspaceId in s.failedByWorkspace)) return {};
		const { [workspaceId]: _droppedSpecs, ...specsByWorkspace } = s.specsByWorkspace;
		const { [workspaceId]: _droppedFailed, ...failedByWorkspace } = s.failedByWorkspace;
		return { specsByWorkspace, failedByWorkspace };
	});
}

function normalizePath(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function isAbsolutePath(path: string): boolean {
	const normalized = normalizePath(path);
	return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
}

function matchesWorktreePath(reported: string, rel: string): boolean {
	const path = normalizePath(reported);
	if (path === rel) return true;
	return isAbsolutePath(path) && path.endsWith(`/${rel}`);
}

export function specPathMatcher(nodes: SpecGraphNode[]): (path: string) => boolean {
	const paths = nodes.map((node) => node.path);
	return (reported) => paths.some((rel) => matchesWorktreePath(reported, rel));
}
