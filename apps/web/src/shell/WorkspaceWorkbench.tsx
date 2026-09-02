import {
	RiAlertLine as AlertTriangle,
	RiCheckboxCircleLine as CheckCircle2,
	RiFileTransferLine as FileSymlink,
	RiGitBranchLine as GitBranch,
	RiLoader4Line as Loader2,
	RiChatNewLine as MessageSquarePlus,
	RiTerminalBoxLine as SquareTerminal,
} from "@remixicon/react";
import {
	lazy,
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ClaudeMark } from "../components/ClaudeMark";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { QuietScrollArea } from "../components/QuietScrollArea";
import { LoadingRegion } from "../components/Skeleton";
import { DropdownMenuItem } from "../components/ui/dropdown-menu";
import { IconTooltip } from "../components/ui/tooltip";
import { cn, type LayoutAttention, layoutResourceIdentity } from "../lib";
import { ChangesPanel } from "../panels/ChangesPanel";
import { ClaudeConfigPanel } from "../panels/ClaudeConfigPanel";
import { ConfirmDialog } from "../panels/ConfirmDialog";
import { DiffPane } from "../panels/DiffPane";
import { FilePane } from "../panels/FilePane";
import { FileTree } from "../panels/FileTree";
import { isFileTabDirty } from "../panels/fileSave";
import { openFileInTab } from "../panels/openTabs";
import { ProjectTree } from "../panels/ProjectTree";
import { ReviewPanel, selectActiveReviewedPath } from "../panels/ReviewPanel";
import { reviewFlags } from "../panels/reviewModel";
import { SpecsPanel } from "../panels/SpecsPanel";
import { TerminalWorkbenchBody, useTerminalClose } from "../panels/TerminalWorkbench";
import { useWorkspaceReview } from "../panels/useWorkspaceReview";
import { useWorkspaceSpecs } from "../panels/useWorkspaceSpecs";
import {
	type ClaudeCodeSessionState,
	type EditorTab,
	isConnectedGeneration,
	isDefaultWorkspace,
	isExternalWorkspace,
	type LayoutIntent,
	layoutOpenOptionsForNavigation,
	selectContextProject,
	selectDiffTabTargetRef,
	selectReviewDraftCount,
	selectWorkspaceById,
	selectWorkspaceNavTick,
	selectWorkspaceTick,
	toast,
	useAppStore,
} from "../store";
import { createSessionWithSkillBaseline, errorText, getTransport } from "../transport";
import { ChatHost } from "./ChatHost";
import { ClaudeLauncher } from "./ClaudeLauncher";
import {
	currentChatDestination,
	hydrateChatResource,
	useChatLocationReconciliation,
	useDeletedChatPlacementReconciliation,
	useWorkspaceChatCatalogReconciliation,
} from "./chatReconciliation";
import {
	collectAllGroups,
	findPlacedResource,
	findTabLocation,
	type LayoutCenterTab,
	type LayoutTab,
	type LayoutTabFocusRequest,
	type LayoutToolId,
	type PreparedLayoutClose,
	VERTICAL_TABS_WIDTH,
	Workbench,
	type WorkspaceLayoutDocument,
} from "./layout";
import { toLayoutTab, useLayoutIntentProcessing } from "./layoutIntents";
import { commitWorkspaceLayout, useWorkspaceLayoutState } from "./layoutState";
import { syncLegacySelectionFromAttention, useLegacySelectionAdapter } from "./legacySelection";
import { useTerminalPlacementReconciliation } from "./terminalReconciliation";
import { useReportedActiveFile } from "./useReportedActiveFile";
import { WorkspaceChatHistory } from "./WorkspaceChatHistory";

const PlanPane = lazy(() => import("../panels/PlanPane"));

const NO_EDITOR_TABS: EditorTab[] = [];
const NO_CLAUDE_CODE_STATUS: Record<string, ClaudeCodeSessionState> = {};

// Changes and Review are both windows onto git history; without a repository, or before the first
// commit, neither has anything to answer with — see SPEC.md.
const GIT_TOOLS: readonly LayoutToolId[] = ["changes", "review"];
const NO_UNOFFERED_TOOLS: readonly LayoutToolId[] = [];

function gitlessNotice(vcs: "none" | "unborn"): ReactNode {
	return (
		<div
			data-testid="tool-needs-git"
			data-vcs={vcs}
			className="flex h-full items-center justify-center px-16 text-center tr-text-ui text-text-muted"
		>
			{vcs === "none"
				? "This project folder is not a git repository, so there is nothing to compare."
				: "This repository has no commits yet, so there is nothing to compare against."}
		</div>
	);
}

function MissingResource({ label }: { label: string }) {
	return (
		<LoadingRegion rows={12} label={`Restoring ${label}`} className="h-full overflow-hidden p-16" />
	);
}

const CHAT_RETRY_DELAY_MS = 4000;

function ChatResourceBody({
	workspaceId,
	tab,
	onOpenFile,
}: {
	workspaceId: string;
	tab: Extract<LayoutCenterTab, { kind: "chat" }>;
	onOpenFile: (path: string) => void;
}) {
	const available = useAppStore((state) => state.sessions[tab.sessionId] !== undefined);
	const [stalled, setStalled] = useState(false);
	useEffect(() => {
		if (available) return;
		setStalled(false);
		const timer = setTimeout(() => setStalled(true), CHAT_RETRY_DELAY_MS);
		return () => clearTimeout(timer);
	}, [available, tab.sessionId]);
	if (available) {
		return (
			<ErrorBoundary label="chat" resetKeys={[workspaceId, tab.id]}>
				<Suspense fallback={<MissingResource label="chat" />}>
					<ChatHost sessionId={tab.sessionId} workspaceId={workspaceId} onOpenFile={onOpenFile} />
				</Suspense>
			</ErrorBoundary>
		);
	}
	const retry = () => {
		void hydrateChatResource(workspaceId, tab.sessionId)
			.then((installed) => {
				if (installed) return;
				const { state, current } = currentChatDestination(workspaceId, tab, undefined);
				if (
					current &&
					!state.removedWorkspaceIds[workspaceId] &&
					!state.deletedSessionsByWorkspace[workspaceId]?.[tab.sessionId]
				) {
					toast.error("The chat could not be restored.", "Couldn't restore the chat");
				}
			})
			.catch((error) => {
				const { state, current } = currentChatDestination(workspaceId, tab, undefined);
				if (
					current &&
					!state.removedWorkspaceIds[workspaceId] &&
					!state.deletedSessionsByWorkspace[workspaceId]?.[tab.sessionId]
				) {
					toast.error(errorText(error), "Couldn't restore the chat");
				}
			});
	};
	if (!stalled) return <MissingResource label="chat" />;
	return (
		<div className="flex h-full flex-col items-center justify-center gap-8 text-text-muted">
			<span className="tr-text-ui">The chat is taking longer than usual to restore.</span>
			<button
				type="button"
				onClick={retry}
				className="rounded-[var(--radius-sm)] border border-border-default px-8 py-4 tr-text-ui hover:bg-control-bg-hovered"
			>
				Retry
			</button>
		</div>
	);
}

function useTerminalReservation(workspaceId: string): void {
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const pendingIntent = useAppStore((state) =>
		state.layoutIntents.find(
			(intent): intent is Extract<LayoutIntent, { kind: "place-terminal" }> =>
				intent.kind === "place-terminal" &&
				intent.workspaceId === workspaceId &&
				state.terminalsByWorkspace[workspaceId]?.some(
					(tab) => tab.tabKey === intent.tabKey && tab.reservationPending,
				) === true,
		),
	);

	useEffect(() => {
		if (!pendingIntent || status !== "connected" || connectionGeneration === 0) return;
		let current = true;
		void getTransport()
			.request("terminal.reserve", {
				workspaceId,
				tabKey: pendingIntent.tabKey,
				title: pendingIntent.title,
			})
			.then(() => {
				const state = useAppStore.getState();
				if (
					!current ||
					!isConnectedGeneration(state, connectionGeneration) ||
					state.removedWorkspaceIds[workspaceId]
				) {
					return;
				}
				state.confirmTerminalReservation(workspaceId, pendingIntent.tabKey);
			})
			.catch((error) => {
				const state = useAppStore.getState();
				if (
					!current ||
					!isConnectedGeneration(state, connectionGeneration) ||
					state.removedWorkspaceIds[workspaceId]
				) {
					return;
				}
				const stillPending = state.terminalsByWorkspace[workspaceId]?.some(
					(tab) => tab.tabKey === pendingIntent.tabKey && tab.reservationPending,
				);
				if (!stillPending) return;
				state.rejectTerminalReservation(workspaceId, pendingIntent.tabKey);
				toast.error(errorText(error), "Couldn't create the terminal");
			});
		return () => {
			current = false;
		};
	}, [connectionGeneration, pendingIntent, status, workspaceId]);
}

export function WorkspaceWorkbench({ workspaceId }: { workspaceId: string }) {
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const document = useAppStore((state) => state.layoutDocumentsByWorkspace[workspaceId]);
	const attention = useAppStore((state) => state.layoutAttentionByWorkspace[workspaceId]);
	const projectionEpoch = useAppStore(
		(state) => state.layoutProjectionEpochByWorkspace[workspaceId] ?? 0,
	);
	const layoutPreferences = useAppStore((state) => state.localLayoutPreferences);
	const claudeCodeEnabled = useAppStore((state) => state.claudeCodeEnabled);
	useReportedActiveFile(workspaceId);
	const verticalWidthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (verticalWidthTimer.current) clearTimeout(verticalWidthTimer.current);
		},
		[],
	);
	// Dragging emits a width per frame; only where it came to rest is worth persisting.
	const persistVerticalTabsWidth = useCallback(
		(width: number) => {
			const clamped = Math.min(
				VERTICAL_TABS_WIDTH.max,
				Math.max(VERTICAL_TABS_WIDTH.min, Math.round(width)),
			);
			if (clamped === layoutPreferences.verticalCenterTabsWidth) return;
			if (verticalWidthTimer.current) clearTimeout(verticalWidthTimer.current);
			verticalWidthTimer.current = setTimeout(() => {
				useAppStore
					.getState()
					.setLocalLayoutPreferences({ ...layoutPreferences, verticalCenterTabsWidth: clamped });
			}, 400);
		},
		[layoutPreferences],
	);
	const workspace = useAppStore((state) => selectWorkspaceById(state, workspaceId));
	const vcsGap = workspace?.vcs;
	const unofferedTools = vcsGap ? GIT_TOOLS : NO_UNOFFERED_TOOLS;
	const contextProject = useAppStore(selectContextProject);
	const editorTabs = useAppStore((state) => state.tabsByWorkspace[workspaceId] ?? NO_EDITOR_TABS);
	const chatStarting = useAppStore((state) => (state.chatStartsByWorkspace[workspaceId] ?? 0) > 0);
	const deletedSessions = useAppStore((state) => state.deletedSessionsByWorkspace[workspaceId]);
	const terminalClose = useTerminalClose();
	const specs = useWorkspaceSpecs(workspaceId);
	const review = useWorkspaceReview(workspaceId);
	const reviewComments = useAppStore((state) => state.reviewsByWorkspace[workspaceId]?.comments);
	const reviewDraftCount = useAppStore((state) => selectReviewDraftCount(state, workspaceId));
	const reviewFlagByPath = useMemo(() => reviewFlags(reviewComments), [reviewComments]);
	const claudeCodeByTerminal = useAppStore(
		(state) => state.claudeCodeByTerminal[workspaceId] ?? NO_CLAUDE_CODE_STATUS,
	);
	const [focusRequest, setFocusRequest] = useState<LayoutTabFocusRequest | null>(null);
	const activeReviewedPath = useAppStore((state) => selectActiveReviewedPath(state, workspaceId));
	const readActiveReviewedPath = useCallback(
		() => selectActiveReviewedPath(useAppStore.getState(), workspaceId),
		[workspaceId],
	);
	const openToolFile = useCallback(
		(path: string) => {
			void openFileInTab(workspaceId, path, "preview");
		},
		[workspaceId],
	);

	useWorkspaceLayoutState(workspaceId);

	useEffect(() => {
		if (!document) return;
		const state = useAppStore.getState();
		if (state.layoutDocumentsByWorkspace[workspaceId] !== document) return;
		const placed = new Set(
			collectAllGroups(document)
				.flatMap((group) => group.tabs)
				.map(layoutResourceIdentity),
		);
		const opening = new Set(
			state.layoutIntents.flatMap((intent) => {
				if (intent.workspaceId !== workspaceId || intent.kind !== "open") return [];
				const resource = toLayoutTab(intent.tab);
				return resource ? [layoutResourceIdentity(resource)] : [];
			}),
		);
		for (const tab of editorTabs) {
			const resource = toLayoutTab(tab);
			const identity = resource ? layoutResourceIdentity(resource) : null;
			if (identity && (placed.has(identity) || opening.has(identity))) continue;
			const latest = useAppStore.getState();
			if (latest.layoutDocumentsByWorkspace[workspaceId] !== document) return;
			const current = (latest.tabsByWorkspace[workspaceId] ?? []).find(
				(candidate) => candidate.id === tab.id,
			);
			const currentResource = current ? toLayoutTab(current) : null;
			if (
				!current ||
				!identity ||
				!currentResource ||
				layoutResourceIdentity(currentResource) !== identity
			) {
				continue;
			}
			if (current.kind === "chat") {
				latest.closeChatToHistory(current.sessionId, false, workspaceId, false);
			} else {
				latest.closeTab(current.id, false, false, workspaceId);
			}
		}
	}, [document, editorTabs, workspaceId]);

	const changeAttention = useCallback(
		(next: LayoutAttention) => {
			const state = useAppStore.getState();
			if (state.removedWorkspaceIds[workspaceId]) return;
			state.setLayoutAttention(workspaceId, next);
			syncLegacySelectionFromAttention(workspaceId);
		},
		[workspaceId],
	);

	const commit = useCallback(
		(next: WorkspaceLayoutDocument) => {
			void commitWorkspaceLayout(workspaceId, next, document).catch(() => {});
		},
		[document, workspaceId],
	);

	useLegacySelectionAdapter(workspaceId, activeReviewedPath, readActiveReviewedPath);
	useDeletedChatPlacementReconciliation(workspaceId);
	useTerminalReservation(workspaceId);
	useLayoutIntentProcessing(workspaceId, commit, changeAttention, setFocusRequest);
	useWorkspaceChatCatalogReconciliation(workspaceId, commit);
	const { terminals } = useTerminalPlacementReconciliation(workspaceId, commit);
	useChatLocationReconciliation(workspaceId, changeAttention);

	useEffect(() => {
		if (!document || status !== "connected") return;
		if (useAppStore.getState().layoutDocumentsByWorkspace[workspaceId] !== document) return;
		let current = true;
		const cache = useAppStore.getState().tabsByWorkspace[workspaceId] ?? [];
		const cachedResources = new Set(
			cache.flatMap((item) => {
				const resource = toLayoutTab(item);
				return resource &&
					(resource.kind === "file" ||
						resource.kind === "external-file" ||
						resource.kind === "diff")
					? [layoutResourceIdentity(resource)]
					: [];
			}),
		);
		for (const tab of collectAllGroups(document).flatMap((group) => group.tabs)) {
			if (tab.kind !== "file" && tab.kind !== "external-file" && tab.kind !== "diff") continue;
			const identity = layoutResourceIdentity(tab);
			if (cachedResources.has(identity)) continue;
			const cacheArrived = () =>
				(useAppStore.getState().tabsByWorkspace[workspaceId] ?? []).some((item) => {
					const resource = toLayoutTab(item);
					return resource !== null && layoutResourceIdentity(resource) === identity;
				});
			const currentPlacement = () => {
				const latest = useAppStore.getState().layoutDocumentsByWorkspace[workspaceId];
				return latest ? findPlacedResource(latest, tab) : null;
			};
			const loadedTick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
			if (tab.kind === "file" || tab.kind === "external-file") {
				const external = tab.kind === "external-file";
				void getTransport()
					.request(external ? "claudeConfig.readFile" : "fs.readFile", {
						workspaceId,
						path: tab.path,
					})
					.then(({ content }) => {
						const latest = useAppStore.getState();
						if (!current || !isConnectedGeneration(latest, connectionGeneration)) return;
						const placed = currentPlacement();
						if (placed?.kind !== tab.kind || cacheArrived()) return;
						useAppStore.getState().openTab(
							{
								kind: tab.kind,
								id: placed.id,
								workspaceId,
								path: placed.path,
								name: placed.name,
								content,
								loadedTick,
							},
							"keep",
							false,
							{ activate: false },
						);
					})
					.catch(() => {});
			} else {
				const loadedTarget = selectDiffTabTargetRef(useAppStore.getState(), {
					workspaceId,
					scope: tab.scope,
				});
				void getTransport()
					.request("git.diffFile", { workspaceId, path: tab.path, scope: tab.scope })
					.then(({ original, modified }) => {
						const latest = useAppStore.getState();
						if (!current || !isConnectedGeneration(latest, connectionGeneration)) return;
						const placed = currentPlacement();
						if (placed?.kind !== "diff" || cacheArrived()) return;
						useAppStore.getState().openTab(
							{
								kind: "diff",
								id: placed.id,
								workspaceId,
								path: placed.path,
								scope: placed.scope,
								name: placed.name,
								original,
								modified,
								loadedTick,
								loadedTarget,
							},
							"keep",
							false,
							{ activate: false },
						);
					})
					.catch(() => {});
			}
		}
		return () => {
			current = false;
		};
	}, [connectionGeneration, document, status, workspaceId]);

	const editorById = useMemo(() => new Map(editorTabs.map((tab) => [tab.id, tab])), [editorTabs]);
	const editorByResource = useMemo(() => {
		const resources = new Map<
			string,
			Extract<EditorTab, { kind: "file" }> | Extract<EditorTab, { kind: "diff" }>
		>();
		for (const tab of editorTabs) {
			if (tab.kind !== "file" && tab.kind !== "diff") continue;
			const identity = layoutResourceIdentity(tab);
			if (!resources.has(identity)) resources.set(identity, tab);
		}
		return resources;
	}, [editorTabs]);
	const terminalByKey = useMemo(
		() => new Map(terminals.map((tab) => [tab.tabKey, tab])),
		[terminals],
	);

	const renderTabBody = useCallback(
		(tab: LayoutCenterTab | Extract<LayoutTab, { kind: "terminal" }>) => {
			if (tab.kind === "chat") {
				return <ChatResourceBody workspaceId={workspaceId} tab={tab} onOpenFile={openToolFile} />;
			}
			if (tab.kind === "document") {
				if (deletedSessions?.[tab.sourceId]) return <MissingResource label="plan" />;
				return (
					<ErrorBoundary label="plan" resetKeys={[workspaceId, tab.id]}>
						<Suspense fallback={<MissingResource label="plan" />}>
							<PlanPane workspaceId={workspaceId} sessionId={tab.sourceId} />
						</Suspense>
					</ErrorBoundary>
				);
			}
			if (tab.kind === "terminal") {
				const terminal = terminalByKey.get(tab.tabKey);
				const location = document ? findTabLocation(document, tab.id) : null;
				return (
					<ErrorBoundary label="terminal" resetKeys={[workspaceId, tab.id]}>
						{terminal ? (
							<TerminalWorkbenchBody
								tab={terminal}
								onAdd={() =>
									useAppStore
										.getState()
										.addTerminal(workspaceId, undefined, location?.groupId, location?.area)
								}
							/>
						) : (
							<MissingResource label="terminal" />
						)}
					</ErrorBoundary>
				);
			}
			const identity = layoutResourceIdentity(tab);
			const exact = editorById.get(tab.id);
			const editor =
				exact &&
				(exact.kind === "file" || exact.kind === "external-file" || exact.kind === "diff") &&
				layoutResourceIdentity(exact) === identity
					? exact
					: editorByResource.get(identity);
			if (!editor) return <MissingResource label={tab.kind === "diff" ? "diff" : "file"} />;
			return (
				<ErrorBoundary label="editor" resetKeys={[workspaceId, tab.id]}>
					<Suspense fallback={<MissingResource label="editor" />}>
						{editor.kind === "file" || editor.kind === "external-file" ? (
							<FilePane tab={editor} />
						) : editor.kind === "diff" ? (
							<DiffPane tab={editor} />
						) : null}
					</Suspense>
				</ErrorBoundary>
			);
		},
		[
			deletedSessions,
			document,
			editorById,
			editorByResource,
			openToolFile,
			terminalByKey,
			workspaceId,
		],
	);

	const renderToolBody = useCallback(
		(tool: LayoutToolId) => {
			let body: ReactNode;
			switch (tool) {
				case "projects":
					body = (
						<QuietScrollArea data-testid="left-nav" className="h-full" viewportClassName="p-12">
							<ProjectTree />
						</QuietScrollArea>
					);
					break;
				case "specs":
					body = (
						<QuietScrollArea className="h-full" viewportClassName="p-12">
							<SpecsPanel workspaceId={workspaceId} failed={specs.failed} onRetry={specs.reload} />
						</QuietScrollArea>
					);
					break;
				case "files":
					body = (
						<QuietScrollArea className="h-full" viewportClassName="p-12">
							<FileTree key={workspaceId} workspaceId={workspaceId} />
						</QuietScrollArea>
					);
					break;
				case "changes":
					body = vcsGap ? gitlessNotice(vcsGap) : <ChangesPanel workspaceId={workspaceId} />;
					break;
				case "review":
					body = vcsGap ? (
						gitlessNotice(vcsGap)
					) : (
						<ReviewPanel workspaceId={workspaceId} failed={review.failed} />
					);
					break;
				case "claude":
					body = claudeCodeEnabled ? (
						<ClaudeConfigPanel workspaceId={workspaceId} />
					) : (
						// A layout saved while it was on outlives the setting, so the tab explains itself
						// rather than rendering a pane that would be refused by the host anyway.
						<div className="flex h-full items-center justify-center px-16 text-center tr-text-ui text-text-muted">
							Claude Code integration is off. Turn it on in Settings.
						</div>
					);
					break;
			}
			return (
				<ErrorBoundary label={`${tool} tool`} resetKeys={[workspaceId, tool]}>
					{body}
				</ErrorBoundary>
			);
		},
		[review.failed, specs.failed, specs.reload, workspaceId, claudeCodeEnabled, vcsGap],
	);

	const isDefault = workspace != null && isDefaultWorkspace(workspace);
	const isExternal = workspace != null && isExternalWorkspace(workspace);

	const startChat = useCallback(
		(groupId: string) => {
			const currentAttention = useAppStore.getState().layoutAttentionByWorkspace[workspaceId];
			if (!currentAttention) return;
			changeAttention({ ...currentAttention, lastFocusedCenterGroupId: groupId });
			const navigation = useAppStore.getState().beginCenterNavigation(workspaceId, groupId);
			useAppStore.getState().beginChatStart(workspaceId);
			void createSessionWithSkillBaseline({ workspaceId })
				.then(({ result: { sessionId, model, thinkingLevel }, syncedTick }) => {
					const store = useAppStore.getState();
					store.openChatSession(
						workspaceId,
						sessionId,
						model,
						thinkingLevel,
						syncedTick,
						layoutOpenOptionsForNavigation(store, workspaceId, navigation),
					);
				})
				.catch((cause: unknown) => {
					const state = useAppStore.getState();
					if (
						layoutOpenOptionsForNavigation(state, workspaceId, navigation).activate !== false &&
						!state.removedWorkspaceIds[workspaceId]
					) {
						// The host says why — a missing extension, an unauthenticated provider — and a fixed
						// string threw that away, leaving nothing to act on.
						toast.error(errorText(cause), "Couldn't start the chat");
					}
				})
				.finally(() => useAppStore.getState().endChatStart(workspaceId));
		},
		[changeAttention, workspaceId],
	);

	const dirtyTabPaths = useAppStore((state) => {
		const paths = (state.tabsByWorkspace[workspaceId] ?? [])
			.filter(isFileTabDirty)
			.map((tab) => (tab as { path: string }).path);
		return paths.length > 0 ? paths.join("\u0000") : "";
	});
	const dirtyPaths = useMemo(
		() => new Set(dirtyTabPaths ? dirtyTabPaths.split("\u0000") : []),
		[dirtyTabPaths],
	);
	const [discardTarget, setDiscardTarget] = useState<{ name: string; close: () => void } | null>(
		null,
	);

	const closeResourceTab = useCallback(
		(tab: LayoutTab, prepare: (document?: WorkspaceLayoutDocument) => PreparedLayoutClose) => {
			const prepared = prepare();
			const closedIdentity = layoutResourceIdentity(tab);
			void commitWorkspaceLayout(workspaceId, prepared.document, document)
				.then(() => {
					const state = useAppStore.getState();
					const current = state.layoutDocumentsByWorkspace[workspaceId];
					if (
						current &&
						collectAllGroups(current)
							.flatMap((group) => group.tabs)
							.some((candidate) => layoutResourceIdentity(candidate) === closedIdentity)
					) {
						return;
					}
					prepared.onAccepted(current);
					if (tab.kind === "chat") {
						state.closeChatToHistory(tab.sessionId, false, workspaceId, false);
					} else if (
						tab.kind === "file" ||
						tab.kind === "external-file" ||
						tab.kind === "diff" ||
						tab.kind === "document"
					) {
						for (const cache of state.tabsByWorkspace[workspaceId] ?? []) {
							const resource = toLayoutTab(cache);
							if (resource && layoutResourceIdentity(resource) === closedIdentity) {
								state.closeTab(cache.id, false, false, workspaceId);
							}
						}
					}
				})
				.catch(() => {});
		},
		[workspaceId, document],
	);

	if (!document || !attention) {
		return (
			<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
				Restoring workspace layout…
			</div>
		);
	}

	return (
		<div data-testid="workspace-workbench" data-layout-status="settled" className="contents">
			<Workbench
				document={document}
				unofferedTools={unofferedTools}
				attention={attention}
				maxSideGroups={layoutPreferences.maxSideGroups}
				maxBottomGroups={layoutPreferences.maxBottomGroups}
				verticalCenterTabs={layoutPreferences.verticalCenterTabs}
				verticalCenterTabsWidth={layoutPreferences.verticalCenterTabsWidth}
				onVerticalCenterTabsWidthChange={persistVerticalTabsWidth}
				defaultPaneDirection={layoutPreferences.defaultPaneDirection}
				projectionEpoch={projectionEpoch}
				{...(focusRequest ? { focusRequest } : {})}
				renderTabBody={renderTabBody}
				renderTabIcon={(tab, active) => {
					// Claude's colour only on the active tab. See shell/SPEC.md.
					const mark = (
						<ClaudeMark className={cn("size-14 shrink-0", active && "text-agent-claude")} />
					);
					if (
						claudeCodeEnabled &&
						tab.kind === "terminal" &&
						terminalByKey.get(tab.tabKey)?.agent === "claude"
					) {
						return mark;
					}
					if (claudeCodeEnabled && tab.kind === "tool" && tab.tool === "claude") return mark;
					if (tab.kind === "external-file") {
						return (
							<FileSymlink
								aria-label={`Outside the worktree: ${tab.path}`}
								className="size-14 shrink-0 text-agent-claude"
							/>
						);
					}
					return null;
				}}
				renderTabAdornment={(tab) => {
					if ((tab.kind === "file" || tab.kind === "external-file") && dirtyPaths.has(tab.path)) {
						return (
							<span
								data-testid="file-unsaved-dot"
								role="img"
								aria-label="Unsaved changes"
								className="size-6 shrink-0 rounded-full bg-feedback-warning"
							/>
						);
					}
					if (tab.kind === "tool" && tab.tool === "review" && reviewDraftCount > 0) {
						return (
							<span
								data-testid="review-pending-badge"
								className="inline-flex min-w-16 items-center justify-center rounded-full bg-primary px-2 tr-text-label-pill text-text-on-primary"
							>
								{reviewDraftCount}
							</span>
						);
					}
					if (tab.kind === "terminal") {
						const claudeCode = claudeCodeByTerminal[tab.tabKey];
						if (!claudeCode) return null;
						if (claudeCode.status === "running") {
							return (
								<Loader2
									data-testid="terminal-claude-code-status"
									data-status="running"
									className="size-12 shrink-0 animate-spin text-text-muted motion-reduce:animate-none"
								/>
							);
						}
						if (claudeCode.status === "blocked") {
							return (
								<span
									data-testid="terminal-claude-code-status"
									data-status="blocked"
									role="status"
									aria-label="Claude needs your input"
									title="Claude needs your input"
									className="size-8 shrink-0 animate-pulse rounded-full bg-feedback-warning motion-reduce:animate-none"
								/>
							);
						}
						if (claudeCode.status === "done") {
							return (
								<CheckCircle2
									data-testid="terminal-claude-code-status"
									data-status="done"
									aria-label="Claude finished"
									className="size-12 shrink-0 text-feedback-success"
								/>
							);
						}
						if (claudeCode.status === "failed") {
							return (
								<AlertTriangle
									data-testid="terminal-claude-code-status"
									data-status="failed"
									aria-label="Claude hit an error"
									className="size-12 shrink-0 text-feedback-error"
								/>
							);
						}
						return null;
					}
					if (tab.kind !== "file" && tab.kind !== "diff") return null;
					const flag = reviewFlagByPath.get(tab.path);
					return flag ? (
						<span
							data-testid="review-tab-flag"
							data-flag={flag}
							className={
								flag === "draft"
									? "shrink-0 tr-text-eyebrow text-primary"
									: "shrink-0 tr-text-eyebrow text-text-subtle"
							}
						>
							Review
						</span>
					) : null;
				}}
				renderToolBody={renderToolBody}
				renderEmptyCenter={(groupId) => (
					<div
						data-testid="workspace-ready"
						className="flex h-full flex-col items-center justify-center gap-4 px-16 text-center"
					>
						<span className="tr-text-eyebrow text-text-muted">
							{isDefault
								? "Default workspace"
								: isExternal
									? "Existing worktree"
									: "Workspace ready"}
						</span>
						{workspace ? (
							<>
								<h2 className="max-w-full truncate tr-title-entity text-text-default">
									{isDefault ? (contextProject?.name ?? workspace.name) : workspace.name}
								</h2>
								<p className="flex max-w-full items-center gap-4 tr-text-metadata text-text-muted">
									<GitBranch className="size-14 shrink-0" />
									{isDefault || isExternal ? (
										<span className="truncate">on {workspace.branch}</span>
									) : (
										<>
											<span className="truncate">{workspace.branch}</span>
											<span className="shrink-0 text-text-muted">
												· from {workspace.baseBranch}
											</span>
										</>
									)}
								</p>
							</>
						) : null}
						<p className="mt-4 tr-text-ui text-text-muted">
							{isDefault
								? "Chats, changes, and terminals run directly in your project folder."
								: "Files, chats, changes, and terminals are scoped to this workspace."}
						</p>
						<button
							type="button"
							data-testid="start-chat"
							data-starting={chatStarting || undefined}
							disabled={chatStarting}
							onClick={() => startChat(groupId)}
							className="mt-4 flex items-center gap-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-12 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered disabled:text-text-muted disabled:hover:bg-container-elevated-bg"
						>
							{chatStarting ? (
								<>
									<Loader2 className="size-14 animate-spin motion-reduce:animate-none" /> Starting
									chat…
								</>
							) : (
								<>
									<MessageSquarePlus className="size-14" /> New chat
								</>
							)}
						</button>
					</div>
				)}
				renderCenterActions={(groupId) => (
					<>
						<WorkspaceChatHistory workspaceId={workspaceId} targetGroupId={groupId} />
						{claudeCodeEnabled ? (
							<ClaudeLauncher workspaceId={workspaceId} groupId={groupId} />
						) : null}
						<IconTooltip label="New terminal in this group">
							<button
								type="button"
								data-testid="new-terminal"
								aria-label="New terminal in this group"
								onClick={() => useAppStore.getState().addTerminal(workspaceId, undefined, groupId)}
								className="flex w-32 shrink-0 items-center justify-center border-border-default border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
							>
								<SquareTerminal className="size-14" />
							</button>
						</IconTooltip>
					</>
				)}
				renderSideMenuActions={(side, groupId) =>
					side === "right" ? (
						<DropdownMenuItem
							data-testid="side-new-terminal"
							onSelect={() =>
								useAppStore.getState().addTerminal(workspaceId, undefined, groupId, side)
							}
						>
							New terminal
						</DropdownMenuItem>
					) : null
				}
				onCommit={commit}
				onAttentionChange={changeAttention}
				onUserNavigation={() => useAppStore.getState().noteNavigation(workspaceId)}
				readNavigationTick={() => selectWorkspaceNavTick(useAppStore.getState(), workspaceId)}
				onRequestClose={(tab, prepare) => {
					if ((tab.kind === "file" || tab.kind === "external-file") && dirtyPaths.has(tab.path)) {
						setDiscardTarget({ name: tab.name, close: () => closeResourceTab(tab, prepare) });
						return;
					}
					if (tab.kind === "terminal") {
						const close = () => {
							const state = useAppStore.getState();
							if (state.removedWorkspaceIds[workspaceId]) return;
							const latest = state.layoutDocumentsByWorkspace[workspaceId];
							const prepared = prepare(latest);
							if (!latest || prepared.document !== latest) {
								void commitWorkspaceLayout(workspaceId, prepared.document, latest).catch(() => {});
							}
							prepared.onAccepted(useAppStore.getState().layoutDocumentsByWorkspace[workspaceId]);
						};
						const terminal = terminalByKey.get(tab.tabKey);
						if (terminal) terminalClose.requestClose(terminal, close);
						else close();
						return;
					}
					closeResourceTab(tab, prepare);
				}}
				onNewChat={startChat}
				onNewTerminal={(groupId, area) =>
					useAppStore.getState().addTerminal(workspaceId, undefined, groupId, area)
				}
				onGestureCanceled={() => toast.info("The layout changed. Your drag was canceled.")}
			/>
			{terminalClose.confirmation}
			<ConfirmDialog
				open={discardTarget !== null}
				onOpenChange={(open) => {
					if (!open) setDiscardTarget(null);
				}}
				title="Unsaved changes"
				description={`“${discardTarget?.name ?? "This file"}” has edits that were never written to disk. Closing the tab throws them away.`}
				confirmLabel="Discard and close"
				confirmTestId="file-discard-confirm"
				destructive
				onConfirm={() => {
					discardTarget?.close();
					setDiscardTarget(null);
				}}
			/>
		</div>
	);
}
