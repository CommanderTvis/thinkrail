import type { GitDiffScope } from "@thinkrail/contracts";
import type { LayoutOpenOptions } from "@/store";
import {
	DOUBLE_CLICK_SETTLE_MS,
	isAbsolutePath,
	isImagePath,
	isPdfPath,
	layoutResourceIdentity,
	projectRelativePath,
	tupleKey,
} from "../lib";
import {
	type CenterNavigationStamp,
	type EditorTab,
	isCenterNavigationCurrent,
	layoutOpenOptionsForNavigation,
	selectDiffTabTargetRef,
	selectWorkspaceById,
	selectWorkspaceNavTick,
	selectWorkspaceTick,
	type TabIntent,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import { diffTabId, diffTabName } from "./changesModel";

function baseName(path: string): string {
	return path.split("/").pop() || path;
}

const inFlight = new Map<
	string,
	{
		intent: TabIntent;
		claimPreview: boolean;
		navigation: CenterNavigationStamp | null;
		requestedAt: number;
		startedAt: number;
	}
>();

function navTick(workspaceId: string): number {
	return selectWorkspaceNavTick(useAppStore.getState(), workspaceId);
}

async function openReadTab<T>(
	workspaceId: string,
	id: string,
	resourceIdentity: string,
	requestedIntent: TabIntent,
	read: () => Promise<T>,
	build: (payload: T, loadedTick: number) => EditorTab,
	requestedNavigation?: CenterNavigationStamp | null,
	extraOptions?: Partial<LayoutOpenOptions>,
): Promise<void> {
	// With the preview slot turned off every open keeps: nothing claims the slot, and no open waits out
	// the double-click window to find out whether it was one. See panels/SPEC.md.
	const intent: TabIntent = useAppStore.getState().localLayoutPreferences.previewTabs
		? requestedIntent
		: "keep";
	const navigation =
		requestedNavigation === undefined
			? useAppStore.getState().beginCenterNavigation(workspaceId)
			: requestedNavigation;
	const store = useAppStore.getState();
	if (store.removedWorkspaceIds[workspaceId]) return;
	if (intent === "preview" && !isCenterNavigationCurrent(store, workspaceId, navigation)) return;
	const pending = inFlight.get(id);
	if (pending) {
		if (intent === "preview") pending.claimPreview = true;
		if (intent === "keep") pending.intent = "keep";
		pending.navigation = navigation;
		pending.requestedAt = navTick(workspaceId);
		return;
	}
	const flight = {
		intent,
		claimPreview: intent === "preview",
		navigation,
		requestedAt: navTick(workspaceId),
		startedAt: Date.now(),
	};
	inFlight.set(id, flight);
	const cached = (store.tabsByWorkspace[workspaceId] ?? []).find(
		(tab) =>
			(tab.kind === "file" || tab.kind === "diff") &&
			layoutResourceIdentity(tab) === resourceIdentity,
	);
	if (cached) {
		try {
			if (flight.intent === "preview") {
				await new Promise((resolve) => setTimeout(resolve, DOUBLE_CLICK_SETTLE_MS));
			}
			const currentState = useAppStore.getState();
			const latestCached = (currentState.tabsByWorkspace[workspaceId] ?? []).find(
				(tab) =>
					(tab.kind === "file" || tab.kind === "diff") &&
					layoutResourceIdentity(tab) === resourceIdentity,
			);
			if (!latestCached) return;
			const overtaken = flight.navigation
				? !isCenterNavigationCurrent(currentState, workspaceId, flight.navigation)
				: navTick(workspaceId) !== flight.requestedAt;
			if (flight.intent === "preview" && overtaken) return;
			const options = layoutOpenOptionsForNavigation(currentState, workspaceId, flight.navigation);
			useAppStore
				.getState()
				.openTab(
					latestCached,
					flight.intent,
					true,
					flight.intent === "keep" && flight.claimPreview && !overtaken
						? { ...options, ...extraOptions, claimPreview: true }
						: { ...options, ...extraOptions },
				);
		} finally {
			inFlight.delete(id);
		}
		return;
	}
	const loadedTick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
	try {
		const payload = await read();
		if (flight.intent === "preview") {
			const remaining = DOUBLE_CLICK_SETTLE_MS - (Date.now() - flight.startedAt);
			if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
		}
		const currentState = useAppStore.getState();
		const overtaken = flight.navigation
			? !isCenterNavigationCurrent(currentState, workspaceId, flight.navigation)
			: navTick(workspaceId) !== flight.requestedAt;
		if (flight.intent === "preview" && overtaken) return;
		const installedCache = (currentState.tabsByWorkspace[workspaceId] ?? []).find(
			(tab) =>
				(tab.kind === "file" || tab.kind === "diff") &&
				layoutResourceIdentity(tab) === resourceIdentity,
		);
		const tab = installedCache ?? build(payload, loadedTick);
		const options = layoutOpenOptionsForNavigation(currentState, workspaceId, flight.navigation);
		useAppStore
			.getState()
			.openTab(
				tab,
				flight.intent,
				true,
				flight.intent === "keep" && flight.claimPreview && !overtaken
					? { ...options, ...extraOptions, claimPreview: true }
					: { ...options, ...extraOptions },
			);
	} catch {
	} finally {
		inFlight.delete(id);
	}
}

export function openFileInTab(
	workspaceId: string,
	reported: string,
	intent: TabIntent,
	requestedNavigation?: CenterNavigationStamp | null,
	extraOptions?: Partial<LayoutOpenOptions>,
): Promise<void> {
	const path = projectRelativePath(
		reported,
		selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath,
	);
	// An absolute path here is one that fell outside the worktree: the worktree-relative form cannot name
	// it, so it becomes its own tab kind rather than an invalid file tab — see contracts' LayoutExternalFileTab.
	const external = isAbsolutePath(path);
	const kind = external ? ("external-file" as const) : ("file" as const);
	const id = tupleKey(kind, workspaceId, path);
	// A PDF is rendered by pointing an <iframe> at the worktree file route directly (see PdfPreview.tsx) —
	// reading it here would decode binary bytes as UTF-8 text for content nothing uses.
	const binary = !external && (isPdfPath(path) || isImagePath(path));
	return openReadTab(
		workspaceId,
		id,
		layoutResourceIdentity({ kind, id, name: baseName(path), path }),
		intent,
		() =>
			binary
				? Promise.resolve({ content: "", hash: "" })
				: external
					? getTransport().request("claudeConfig.readFile", { workspaceId, path })
					: getTransport().request("fs.readFile", { workspaceId, path }),
		({ content, hash }, loadedTick) => ({
			kind,
			id,
			workspaceId,
			path,
			name: baseName(path),
			content,
			hash,
			loadedTick,
		}),
		requestedNavigation,
		extraOptions,
	);
}

export function openDiffInTab(
	workspaceId: string,
	scope: GitDiffScope,
	path: string,
	intent: TabIntent,
	requestedNavigation?: CenterNavigationStamp | null,
): Promise<void> {
	const canonicalPath = projectRelativePath(
		path,
		selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath,
	);
	const id = diffTabId(workspaceId, scope, canonicalPath);
	const target = selectDiffTabTargetRef(useAppStore.getState(), { workspaceId, scope });
	return openReadTab(
		workspaceId,
		id,
		layoutResourceIdentity({
			kind: "diff",
			id,
			name: diffTabName(scope, canonicalPath),
			path: canonicalPath,
			scope,
		}),
		intent,
		() => getTransport().request("git.diffFile", { workspaceId, path: canonicalPath, scope }),
		({ original, modified }, loadedTick) => ({
			kind: "diff",
			id,
			workspaceId,
			path: canonicalPath,
			scope,
			name: diffTabName(scope, canonicalPath),
			original,
			modified,
			loadedTick,
			loadedTarget: target,
		}),
		requestedNavigation,
	);
}
