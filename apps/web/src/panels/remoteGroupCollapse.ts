import { useCallback, useState } from "react";

const STORAGE_KEY = "thinkrail.branchRemoteGroupsCollapsed";

function remoteGroupKey(remote: string | null): string {
	return remote ?? "\u0000other";
}

function readCollapsed(): Record<string, boolean> {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : null;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function writeCollapsed(next: Record<string, boolean>): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {}
}

/** A remote's collapsed/expanded state, remembered per browser across every branch picker and list. */
export function useRemoteGroupCollapse(): {
	isCollapsed: (remote: string | null) => boolean;
	toggle: (remote: string | null) => void;
} {
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
	const toggle = useCallback((remote: string | null) => {
		setCollapsed((prev) => {
			const key = remoteGroupKey(remote);
			const next = { ...prev, [key]: !prev[key] };
			writeCollapsed(next);
			return next;
		});
	}, []);
	const isCollapsed = useCallback(
		(remote: string | null) => collapsed[remoteGroupKey(remote)] === true,
		[collapsed],
	);
	return { isCollapsed, toggle };
}
