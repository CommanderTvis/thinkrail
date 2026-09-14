import type { GitDiffScope } from "@thinkrail/contracts";
import type { LayoutOpenOptions } from "@/store";
import {
	DOUBLE_CLICK_SETTLE_MS,
	fileName,
	isAbsolutePath,
	layoutResourceIdentity,
	projectRelativePath,
	tupleKey,
} from "../lib";
import { selectFileViewer, usePluginRegistry } from "../plugins/registry";
import {
	type CenterNavigationStamp,
	type ChangesTab,
	createChangesTab,
	type EditorTab,
	type FileComparisonTab,
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
import { changesTabId, diffTabId } from "./changesModel";
import { emitEditorEvent, findEditorRef } from "./editorEvents";

const SOURCE_RENDERER_ID = "thinkrail/code";

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
	claimPreview = false,
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
		if (intent === "preview" || claimPreview) pending.claimPreview = true;
		if (intent === "keep") pending.intent = "keep";
		pending.navigation = navigation;
		pending.requestedAt = navTick(workspaceId);
		return;
	}
	const cached = (store.tabsByWorkspace[workspaceId] ?? []).find(
		(tab) =>
			(tab.kind === "file" || tab.kind === "diff") &&
			layoutResourceIdentity(tab) === resourceIdentity,
	);
	if (cached) {
		const claim =
			intent === "keep" &&
			claimPreview &&
			(!navigation || isCenterNavigationCurrent(store, workspaceId, navigation));
		const options = {
			...layoutOpenOptionsForNavigation(store, workspaceId, navigation),
			...extraOptions,
		};
		store.openTab(cached, intent, true, claim ? { ...options, claimPreview: true } : options);
		return;
	}
	const flight = {
		intent,
		claimPreview: intent === "preview" || claimPreview,
		navigation,
		requestedAt: navTick(workspaceId),
	};
	inFlight.set(id, flight);
	const loadedTick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
	try {
		const payload = await read();
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
		const options = {
			...layoutOpenOptionsForNavigation(currentState, workspaceId, flight.navigation),
			...extraOptions,
		};
		useAppStore
			.getState()
			.openTab(
				tab,
				flight.intent,
				true,
				flight.intent === "keep" && flight.claimPreview && !overtaken
					? { ...options, claimPreview: true }
					: options,
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
	viewerOptions?: { raw?: boolean },
): Promise<void> {
	const path = projectRelativePath(
		reported,
		selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath,
	);
	const viewer = viewerOptions?.raw ? null : selectFileViewer(usePluginRegistry.getState(), path);
	if (viewer?.open?.(workspaceId, path)) return Promise.resolve();
	// An absolute path here is one that fell outside the worktree: the worktree-relative form cannot name
	// it, so it becomes its own tab kind rather than an invalid file tab — see contracts' LayoutExternalFileTab.
	const external = isAbsolutePath(path);
	const kind = external ? ("external-file" as const) : ("file" as const);
	const id = tupleKey(kind, workspaceId, path);
	return openReadTab(
		workspaceId,
		id,
		layoutResourceIdentity({ kind, id, name: baseName(path), path }),
		intent,
		() => getTransport().request("fs.readFile", { workspaceId, path }),
		({ content, meta }, loadedTick) => ({
			kind,
			id,
			workspaceId,
			path,
			name: baseName(path),
			content,
			meta,
			loadedTick,
			...(viewerOptions?.raw && !external ? { rendererId: SOURCE_RENDERER_ID } : {}),
		}),
		requestedNavigation,
		false,
		extraOptions,
	).then(() => {
		if (viewerOptions?.raw && !external) {
			useAppStore.getState().setTabRenderer(workspaceId, id, SOURCE_RENDERER_ID);
		}
		const ref = findEditorRef(workspaceId, path);
		if (ref) emitEditorEvent({ kind: "opened", editor: ref });
	});
}

export function openDiffInTab(
	workspaceId: string,
	scope: GitDiffScope,
	path: string,
	intent: TabIntent,
	requestedNavigation?: CenterNavigationStamp | null,
	options: { claimPreview?: boolean } = {},
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
			name: fileName(canonicalPath),
			path: canonicalPath,
			scope,
		}),
		intent,
		() => getTransport().request("git.diffFile", { workspaceId, path: canonicalPath, scope }),
		({ original, modified, meta, originalOid }, loadedTick) => ({
			kind: "diff",
			id,
			workspaceId,
			path: canonicalPath,
			scope,
			name: fileName(canonicalPath),
			original,
			modified,
			meta,
			originalOid,
			loadedTick,
			loadedTarget: target,
		}),
		requestedNavigation,
		options.claimPreview,
	);
}

export function fileComparisonTab(
	workspaceId: string,
	before: string,
	path: string,
): FileComparisonTab {
	return {
		kind: "diff",
		id: tupleKey("compare", workspaceId, before, path),
		workspaceId,
		name: `${baseName(before)} → ${baseName(path)}`,
		path,
		before,
	};
}

export function openFileComparisonInTab(
	workspaceId: string,
	before: string,
	path: string,
	intent: TabIntent,
): Promise<void> {
	const worktree = selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath;
	const tab = fileComparisonTab(
		workspaceId,
		projectRelativePath(before, worktree),
		projectRelativePath(path, worktree),
	);
	return openReadTab(
		workspaceId,
		tab.id,
		layoutResourceIdentity(tab),
		intent,
		() => Promise.resolve(null),
		(_payload, loadedTick) => ({ ...tab, loadedTick }),
	);
}

export async function openChangesTab(
	workspaceId: string,
	scope: GitDiffScope,
	options: { revealPath?: string | null } = {},
	intent: TabIntent = "preview",
	requestedNavigation?: CenterNavigationStamp | null,
): Promise<void> {
	const navigation =
		requestedNavigation === undefined
			? useAppStore.getState().beginCenterNavigation(workspaceId)
			: requestedNavigation;
	const requestedAt = navTick(workspaceId);
	if (intent === "preview") {
		await new Promise((resolve) => setTimeout(resolve, DOUBLE_CLICK_SETTLE_MS));
	}
	const state = useAppStore.getState();
	if (state.removedWorkspaceIds[workspaceId]) return;
	const overtaken = navigation
		? !isCenterNavigationCurrent(state, workspaceId, navigation)
		: navTick(workspaceId) !== requestedAt;
	if (intent === "preview" && overtaken) return;
	const id = changesTabId(workspaceId, scope);
	const revealPath = options.revealPath
		? projectRelativePath(options.revealPath, selectWorkspaceById(state, workspaceId)?.worktreePath)
		: null;
	const existing = (state.tabsByWorkspace[workspaceId] ?? []).find(
		(tab): tab is ChangesTab => tab.id === id && tab.kind === "changes",
	);
	const base = existing ?? createChangesTab(workspaceId, id, "", scope);
	const tab: ChangesTab = revealPath
		? { ...base, reveal: { path: revealPath, tick: (base.reveal?.tick ?? 0) + 1 } }
		: base;
	state.openTab(tab, intent, true, layoutOpenOptionsForNavigation(state, workspaceId, navigation));
}
