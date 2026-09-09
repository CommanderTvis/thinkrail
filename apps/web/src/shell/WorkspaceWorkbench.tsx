import {
	RiFileTransferLine as FileSymlink,
	RiGitBranchLine as GitBranch,
	RiChatNewLine as MessageSquarePlus,
	RiTerminalBoxLine as SquareTerminal,
} from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import { t, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { DropdownMenuItem } from "@thinkrail/ui/dropdown-menu";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import {
	Fragment,
	lazy,
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { prepareChatTitle } from "../chat/chatTitle";
import { useAutoPlanSummary } from "../chat/useChatTodos";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { preloadedLazy } from "../components/preloadedLazy";
import { QuietScrollArea } from "../components/QuietScrollArea";
import { type LayoutAttention, layoutResourceIdentity, readLayoutSelection } from "../lib";
import { DiffPane } from "../panels/DiffPane";
import { FilePane } from "../panels/FilePane";
import { FilesPanel } from "../panels/FilesPanel";
import { startChatInTab } from "../panels/openChat";
import { fileComparisonTab, openFileInTab } from "../panels/openTabs";
import { LoadingRegion } from "../components/Skeleton";
import { ChangesPanel } from "../panels/ChangesPanel";
import { ConfirmDialog } from "../panels/ConfirmDialog";
import { FileTree } from "../panels/FileTree";
import { isFileTabDirty } from "../panels/fileSave";
import { ProjectTree } from "../panels/ProjectTree";
import { ReviewPanel, selectActiveReviewedPath } from "../panels/ReviewPanel";
import { reviewFlagForPaths, reviewFlags, tabReviewPaths } from "../panels/reviewModel";
import { SpecsPanel } from "../panels/SpecsPanel";
import { TerminalWorkbenchBody, useTerminalClose } from "../panels/TerminalWorkbench";
import { useWorkspaceReview } from "../panels/useWorkspaceReview";
import { useWorkspaceSpecs } from "../panels/useWorkspaceSpecs";
import {
	type EditorTab,
	editorSessionId,
	isConnectedGeneration,
	isDefaultWorkspace,
	isExternalWorkspace,
	isFileComparison,
	type LayoutIntent,
	layoutOpenOptionsForNavigation,
	selectCanRenameChat,
	selectContextProject,
	selectDiffTabTargetRef,
	selectRailPlanSessionId,
	selectReviewDraftCount,
	selectUnnamedChatFirstPrompts,
	selectWorkspaceById,
	selectWorkspaceNavTick,
	selectWorkspaceTick,
	toast,
	useAppStore,
	workspaceName,
} from "../store";
import { createSessionWithSkillBaseline, errorText, getTransport } from "../transport";
import { ChatHost } from "./ChatHost";
import {
	currentChatDestination,
	hydrateChatResource,
	useChatLocationReconciliation,
	useDeletedChatPlacementReconciliation,
	useWorkspaceChatCatalogReconciliation,
} from "./chatReconciliation";
import { subscribeCloseRequest } from "./closeRequestChannel";
import {
	buildLayoutToolCatalog,
	collectAllGroups,
	findPlacedResource,
	findTabLocation,
	isToolShowing,
	type LayoutCenterTab,
	type LayoutTab,
	type LayoutTabFocusRequest,
	type LayoutToolCatalog,
	type LayoutToolId,
	showingAuxiliaryKey,
	type PreparedLayoutClose,
	selectTab,
	Workbench,
	type WorkspaceLayoutDocument,
} from "./layout";
import { toLayoutTab, useLayoutIntentProcessing } from "./layoutIntents";
import {
	applyLayoutAttention,
	commitWorkspaceLayout,
	emptyWorkspaceProjection,
	useWorkspaceLayoutState,
	workspaceProjectionReference,
} from "./layoutState";
import { syncLegacySelectionFromAttention, useLegacySelectionAdapter } from "./legacySelection";
import { useTerminalPlacementReconciliation } from "./terminalReconciliation";
import { useIdleEditorPreload } from "./useIdleEditorPreload";
import { useReportedActiveFile } from "./useReportedActiveFile";
import { WorkspaceChatHistory } from "./WorkspaceChatHistory";

function PlanSummaryAutoDraft({
	workspaceId,
	sessionId,
}: {
	workspaceId: string;
	sessionId: string;
}) {
	useAutoPlanSummary(workspaceId, sessionId);
	return null;
}

const ChatView = preloadedLazy(() => import("../chat/ChatView"));
const PlanPane = lazy(() => import("../panels/PlanPane"));
const ChangesReviewPane = lazy(() =>
	import("../panels/ChangesReviewPane").then((module) => ({ default: module.ChangesReviewPane })),
);
const PlanRailPane = lazy(() => import("../panels/PlanRailPane"));

const NO_EDITOR_TABS: EditorTab[] = [];

// Changes and Review are both windows onto git history; without a repository, or before the first
// commit, neither has anything to answer with — see SPEC.md.
const GIT_TOOLS: readonly LayoutToolId[] = ["changes", "review"];
const NO_UNOFFERED_TOOLS: readonly LayoutToolId[] = [];

function GitlessNotice({ vcs }: { vcs: "none" | "unborn" }) {
	const t = useT();
	return (
		<div
			data-testid="tool-needs-git"
			data-vcs={vcs}
			className="flex h-full items-center justify-center px-16 text-center tr-text-ui text-text-muted"
		>
			{vcs === "none" ? t("shell.workbench.gitless.none") : t("shell.workbench.gitless.unborn")}
		</div>
	);
}

const RESTORING_LABEL = {
	file: "shell.workbench.restoring.file",
	changes: "shell.workbench.restoring.changes",
	diff: "shell.workbench.restoring.diff",
	editor: "shell.workbench.restoring.editor",
	chat: "shell.workbench.restoring.chat",
	plan: "shell.workbench.restoring.plan",
	terminal: "shell.workbench.restoring.terminal",
} satisfies Record<string, MessageKey>;

function MissingResource({ kind }: { kind: keyof typeof RESTORING_LABEL }) {
	const t = useT();
	return (
		<LoadingRegion
			rows={12}
			label={t(RESTORING_LABEL[kind])}
			className="h-full overflow-hidden p-16"
		/>
	);
}

type EditorResourceTab = Extract<
	LayoutCenterTab,
	{ kind: "file" | "external-file" | "diff" | "changes" }
>;
type EditorResource = Extract<EditorTab, { kind: "file" | "external-file" | "diff" | "changes" }>;

function isEditorResource(tab: EditorTab): tab is EditorResource {
	return (
		tab.kind === "file" ||
		tab.kind === "external-file" ||
		tab.kind === "diff" ||
		tab.kind === "changes"
	);
}

function findEditorResource(
	tabs: readonly EditorTab[],
	id: string,
	identity: string,
): EditorResource | undefined {
	const exact = tabs.find((candidate) => candidate.id === id);
	if (exact && isEditorResource(exact) && layoutResourceIdentity(exact) === identity) return exact;
	return tabs.find(
		(candidate): candidate is EditorResource =>
			isEditorResource(candidate) && layoutResourceIdentity(candidate) === identity,
	);
}

function EditorResourceBody({ workspaceId, tab }: { workspaceId: string; tab: EditorResourceTab }) {
	const t = useT();
	const identity = layoutResourceIdentity(tab);
	const editor = useAppStore((state) =>
		findEditorResource(state.tabsByWorkspace[workspaceId] ?? NO_EDITOR_TABS, tab.id, identity),
	);
	if (!editor) {
		return <MissingResource kind={tab.kind} />;
	}
	return (
		<ErrorBoundary
			label={t("shell.workbench.panel.editor")}
			reportId="editor"
			resetKeys={[workspaceId, tab.id]}
		>
			<Suspense fallback={<MissingResource kind="editor" />}>
				{editor.kind === "file" || editor.kind === "external-file" ? (
					<FilePane tab={editor} />
				) : editor.kind === "diff" ? (
					<DiffPane tab={editor} />
				) : (
					<ChangesReviewPane tab={editor} />
				)}
			</Suspense>
		</ErrorBoundary>
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
	const t = useT();
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
			<ErrorBoundary
				label={t("shell.workbench.panel.chat")}
				reportId="chat"
				resetKeys={[workspaceId, tab.id]}
			>
				<Suspense fallback={<MissingResource kind="chat" />}>
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
					toast.error(
						t("shell.workbench.chatRestoreFailed"),
						t("shell.workbench.chatRestoreFailedTitle"),
					);
				}
			})
			.catch((error) => {
				const { state, current } = currentChatDestination(workspaceId, tab, undefined);
				if (
					current &&
					!state.removedWorkspaceIds[workspaceId] &&
					!state.deletedSessionsByWorkspace[workspaceId]?.[tab.sessionId]
				) {
					toast.error(errorText(error), t("shell.workbench.chatRestoreFailedTitle"));
				}
			});
	};
	if (!stalled) return <MissingResource kind="chat" />;
	return (
		<div className="flex h-full flex-col items-center justify-center gap-8 text-text-muted">
			<span className="tr-text-ui">{t("shell.workbench.chatRestoreSlow")}</span>
			<Button variant="outline" size="m" onClick={retry}>
				{t("common.retry")}
			</Button>
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
				toast.error(errorText(error), t("shell.workbench.terminalCreateFailed"));
			});
		return () => {
			current = false;
		};
	}, [connectionGeneration, pendingIntent, status, workspaceId]);
}

/**
 * A project whose spec graph is empty opens its rail on the next tool instead of on Specs — the default
 * selection is seeded before the graph is read, so it is corrected once, when the answer arrives. The
 * same "seeded before the answer is known, corrected once it arrives" shape applies to a plugin tool
 * whose plugin is inactive or whose `SideToolRegistration.railDefault` refuses this workspace. See
 * shell/SPEC.md.
 */
function useRailDefault(
	workspaceId: string,
	document: WorkspaceLayoutDocument | undefined,
	attention: LayoutAttention | undefined,
	changeAttention: (next: LayoutAttention) => void,
): void {
	const specless = useAppStore((state) => state.specsByWorkspace[workspaceId]?.length === 0);
	const specsAnswered = useRef<string | null>(null);
	useEffect(() => {
		if (!specless || !document || !attention || specsAnswered.current === workspaceId) return;
		specsAnswered.current = workspaceId;
		let next = attention;
		for (const group of collectAllGroups(document)) {
			if (group.location.area === "center") continue;
			const selectedId = readLayoutSelection(next, group.location.groupId);
			const selected = group.tabs.find((tab) => tab.id === selectedId);
			if (selected?.kind !== "tool" || selected.tool !== "specs") continue;
			const other = group.tabs.find((tab) => tab.id !== selected.id);
			if (other) next = selectTab(next, group.location, other.id, false);
		}
		if (next !== attention) changeAttention(next);
	}, [specless, workspaceId, document, attention, changeAttention]);
}

export function WorkspaceWorkbench({ workspaceId }: { workspaceId: string }) {
	const t = useT();
	const catalog: LayoutToolCatalog = useMemo(() => buildLayoutToolCatalog(), []);
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const canRenameChat = useAppStore(selectCanRenameChat);
	const document = useAppStore((state) => state.layoutDocumentsByWorkspace[workspaceId]);
	const attention = useAppStore((state) => state.layoutAttentionByWorkspace[workspaceId]);
	const frame = useAppStore((state) => state.workbenchFrame);
	const projectionEpoch = useAppStore(
		(state) => state.layoutProjectionEpochByWorkspace[workspaceId] ?? 0,
	);
	const layoutPreferences = useAppStore((state) => state.localLayoutPreferences);
	const workspace = useAppStore((state) => selectWorkspaceById(state, workspaceId));
	const vcsGap = workspace?.vcs;
	const unofferedTools = vcsGap ? GIT_TOOLS : NO_UNOFFERED_TOOLS;
	const contextProject = useAppStore(selectContextProject);
	const editorTabs = useAppStore((state) => state.tabsByWorkspace[workspaceId] ?? NO_EDITOR_TABS);
	const planSessionIds = useMemo(() => {
		const seen = new Set<string>();
		for (const tab of editorTabs) {
			const sid = editorSessionId(tab);
			if (sid) seen.add(sid);
		}
		return [...seen];
	}, [editorTabs]);
	const chatStarting = useAppStore((state) => (state.chatStartsByWorkspace[workspaceId] ?? 0) > 0);
	const deletedSessions = useAppStore((state) => state.deletedSessionsByWorkspace[workspaceId]);
	const terminalClose = useTerminalClose();
	const specs = useWorkspaceSpecs(workspaceId);
	const review = useWorkspaceReview(workspaceId);
	useLoadWorkspaceTurns(workspaceId);
	useIdleEditorPreload(workspaceId);
	const reviewComments = useAppStore((state) => state.reviewsByWorkspace[workspaceId]?.comments);
	const railPlanSessionId = useAppStore((state) => selectRailPlanSessionId(state, workspaceId));
	const reviewDraftCount = useAppStore((state) => selectReviewDraftCount(state, workspaceId));
	const reviewFlagByPath = useMemo(() => reviewFlags(reviewComments), [reviewComments]);
	useEffect(() => {
		void ChatView.preload();
	}, []);
	const [focusRequest, setFocusRequest] = useState<LayoutTabFocusRequest | null>(null);
	const requestRenameChat = useCallback(
		(sessionId: string, titleInput: string, currentTitle: string) => {
			const prepared = prepareChatTitle(titleInput);
			if ("reason" in prepared || prepared.title === currentTitle) return;
			void getTransport()
				.request("session.rename", { workspaceId, sessionId, title: prepared.title })
				.catch((error) => toast.error(errorText(error), t("shell.workbench.chatRenameFailed")));
		},
		[t, workspaceId],
	);
	const activeReviewedPath = useAppStore((state) => selectActiveReviewedPath(state, workspaceId));
	const readActiveReviewedPath = useCallback(
		() => selectActiveReviewedPath(useAppStore.getState(), workspaceId),
		[workspaceId],
	);
	const readAuxiliary = useCallback(() => {
		const state = useAppStore.getState();
		const layout = state.layoutDocumentsByWorkspace[workspaceId];
		const layoutAttention = state.layoutAttentionByWorkspace[workspaceId];
		return layout && layoutAttention
			? {
					reviewShowing: isToolShowing(layout, layoutAttention, "review"),
					showingKey: showingAuxiliaryKey(layout, layoutAttention),
				}
			: { reviewShowing: false, showingKey: "" };
	}, [workspaceId]);
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
			applyLayoutAttention(workspaceId, next);
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

	useLegacySelectionAdapter(workspaceId, activeReviewedPath, readActiveReviewedPath, readAuxiliary);
	useDeletedChatPlacementReconciliation(workspaceId);
	useTerminalReservation(workspaceId);
	useLayoutIntentProcessing(workspaceId, commit, changeAttention, setFocusRequest);
	useWorkspaceChatCatalogReconciliation(workspaceId, commit);
	const { terminals } = useTerminalPlacementReconciliation(workspaceId, commit);
	useChatLocationReconciliation(workspaceId, changeAttention);
	useRailDefault(workspaceId, document, attention, changeAttention);

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
			if (tab.kind === "changes") {
				useAppStore
					.getState()
					.openTab(createChangesTab(workspaceId, tab.id, tab.name, tab.scope), "keep", false, {
						activate: false,
					});
				continue;
			}
			if (isFileComparison(tab)) {
				useAppStore
					.getState()
					.openTab(
						{ ...fileComparisonTab(workspaceId, tab.before, tab.path), id: tab.id },
						"keep",
						false,
						{ activate: false },
					);
				continue;
			}
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
				void getTransport()
					.request("fs.readFile", { workspaceId, path: tab.path })
					.then(({ content, meta }) => {
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
								meta,
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
					.then(({ original, modified, meta, originalOid }) => {
						const latest = useAppStore.getState();
						if (!current || !isConnectedGeneration(latest, connectionGeneration)) return;
						const placed = currentPlacement();
						if (placed?.kind !== "diff" || isFileComparison(placed) || cacheArrived()) return;
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
								meta,
								originalOid,
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

	const terminalByKey = useMemo(
		() => new Map(terminals.map((tab) => [tab.tabKey, tab])),
		[terminals],
	);
	const pendingProjection = useMemo(
		() =>
			(document && attention) || !frame
				? null
				: emptyWorkspaceProjection(frame, workspaceProjectionReference(workspaceId)),
		[attention, document, frame, workspaceId],
	);
	const chatFirstPrompts = useAppStore(
		useShallow((state) => selectUnnamedChatFirstPrompts(state, workspaceId)),
	);
	const rendered = document && attention ? { document, attention } : pendingProjection;

	const renderResourceBody = useCallback(
		(tab: LayoutCenterTab | Extract<LayoutTab, { kind: "terminal" }>) => {
			if (tab.kind === "chat") {
				return <ChatResourceBody workspaceId={workspaceId} tab={tab} onOpenFile={openToolFile} />;
			}
			if (tab.kind === "document") {
				if (deletedSessions?.[tab.sourceId]) return <MissingResource kind="plan" />;
				return (
					<ErrorBoundary
						label={t("shell.workbench.panel.plan")}
						reportId="plan"
						resetKeys={[workspaceId, tab.id]}
					>
						<Suspense fallback={<MissingResource kind="plan" />}>
							<PlanPane workspaceId={workspaceId} sessionId={tab.sourceId} />
						</Suspense>
					</ErrorBoundary>
				);
			}
			if (tab.kind === "terminal") {
				const terminal = terminalByKey.get(tab.tabKey);
				const location = document ? findTabLocation(document, tab.id) : null;
				return (
					<ErrorBoundary
						label={t("shell.workbench.panel.terminal")}
						reportId="terminal"
						resetKeys={[workspaceId, tab.id]}
					>
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
							<MissingResource kind="terminal" />
						)}
					</ErrorBoundary>
				);
			}
			return <EditorResourceBody workspaceId={workspaceId} tab={tab} />;
		},
		[
			deletedSessions,
			document,
			openToolFile,
			t,
			terminalByKey,
			workspaceId,
		],
	);
	const renderTabBody = useCallback(
		(tab: LayoutCenterTab | Extract<LayoutTab, { kind: "terminal" }>) => (
			<Fragment key={workspaceId}>{renderResourceBody(tab)}</Fragment>
		),
		[renderResourceBody, workspaceId],
	);

	const toolBodies = useMemo<Record<LayoutToolId, ReactNode>>(() => {
		const bodies: Record<LayoutToolId, ReactNode> = {
			projects: (
				<QuietScrollArea
					data-testid="left-nav"
					className="h-full"
					viewportClassName="p-panel-inset"
				>
					<ProjectTree />
				</QuietScrollArea>
			),
			specs: (
				<QuietScrollArea className="h-full" viewportClassName="p-panel-inset">
					<SpecsPanel workspaceId={workspaceId} failed={specs.failed} onRetry={specs.reload} />
				</QuietScrollArea>
			),
			files: <FilesPanel key={workspaceId} workspaceId={workspaceId} />,
			review: vcsGap ? (
				<GitlessNotice vcs={vcsGap} />
			) : (
				<ReviewPanel key={workspaceId} workspaceId={workspaceId} failed={review.failed} />
			),
			plan: railPlanSessionId ? (
				<ErrorBoundary
					label={t("shell.workbench.panel.planRail")}
					reportId="plan_rail"
					resetKeys={[workspaceId, railPlanSessionId]}
				>
					<Suspense fallback={<MissingResource kind="plan" />}>
						<PlanRailPane workspaceId={workspaceId} sessionId={railPlanSessionId} />
					</Suspense>
				</ErrorBoundary>
			) : (
				<div
					data-testid="plan-rail-empty"
					className="flex h-full items-center justify-center p-16 text-text-subtle tr-text-ui"
				>
					{t("shell.workbench.planRailEmpty")}
				</div>
			),
		};
		for (const tool of Object.keys(bodies) as LayoutToolId[]) {
			bodies[tool] = (
				<ErrorBoundary
					label={t("shell.workbench.panel.tool", { tool })}
					reportId={`${tool}_tool`}
					resetKeys={[workspaceId, tool]}
				>
					{bodies[tool]}
				</ErrorBoundary>
			);
		}
		return bodies;
	}, [railPlanSessionId, review.failed, specs.failed, specs.reload, t, vcsGap, workspaceId]);
	const renderToolBody = useCallback((tool: LayoutToolId) => toolBodies[tool], [toolBodies]);

	const isDefault = workspace != null && isDefaultWorkspace(workspace);
	const isExternal = workspace != null && isExternalWorkspace(workspace);

	const startChat = useCallback(
		(groupId: string) => {
			const currentAttention = useAppStore.getState().layoutAttentionByWorkspace[workspaceId];
			if (!currentAttention) return;
			changeAttention({ ...currentAttention, lastFocusedCenterGroupId: groupId });
			void startChatInTab(workspaceId, { preferredGroupId: groupId });
		},
		[changeAttention, workspaceId],
	);

	const renderTabAdornment = useCallback(
		(tab: LayoutTab): ReactNode => {
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
			if (tab.kind !== "file" && tab.kind !== "diff") return null;
			const flag = reviewFlagForPaths(reviewFlagByPath, tabReviewPaths(tab));
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
					{t("shell.workbench.reviewFlag")}
				</span>
			) : null;
		},
		[reviewDraftCount, reviewFlagByPath, t],
	);

	const renderEmptyCenter = useCallback(
		(groupId: string): ReactNode => (
			<div
				data-testid="workspace-ready"
				className="flex h-full flex-col items-center justify-center gap-4 px-16 text-center"
			>
				<span className="tr-text-eyebrow text-text-muted">
					{isDefault
						? t("shell.workbench.ready.defaultEyebrow")
						: isExternal
							? t("shell.workbench.ready.externalEyebrow")
							: t("shell.workbench.ready.worktreeEyebrow")}
				</span>
				{workspace ? (
					<>
						<h2 className="max-w-full truncate tr-title-entity text-text-default">
							{isDefault ? (contextProject?.name ?? workspaceName(t, workspace)) : workspace.name}
						</h2>
						<p className="flex max-w-full items-center gap-4 tr-text-metadata text-text-muted">
							<GitBranch className="size-14 shrink-0" />
							{isDefault || isExternal ? (
								<span className="truncate">
									{t("shell.workbench.ready.onBranch", { branch: workspace.branch })}
								</span>
							) : (
								<>
									<span className="truncate">{workspace.branch}</span>
									<span className="shrink-0 text-text-muted">
										{t("shell.workbench.ready.fromBase", { base: workspace.baseBranch })}
									</span>
								</>
							)}
						</p>
					</>
				) : null}
				<p className="mt-4 tr-text-ui text-text-muted">
					{isDefault
						? t("shell.workbench.ready.defaultDescription")
						: t("shell.workbench.ready.worktreeDescription")}
				</p>
				<Button
					variant="outline"
					size="m"
					iconLeft={MessageSquarePlus}
					loading={chatStarting}
					data-testid="start-chat"
					data-starting={chatStarting || undefined}
					disabled={chatStarting}
					onClick={() => startChat(groupId)}
					className="mt-4"
				>
					{chatStarting
						? t("shell.workbench.ready.startingChat")
						: t("shell.workbench.ready.newChat")}
				</Button>
			</div>
		),
		[chatStarting, contextProject, isDefault, isExternal, startChat, t, workspace],
	);

	const renderCenterActions = useCallback(
		(groupId: string): ReactNode => (
			<>
				<WorkspaceChatHistory
					key={workspaceId}
					workspaceId={workspaceId}
					targetGroupId={groupId}
					{...(canRenameChat ? { onRenameChat: requestRenameChat } : {})}
				/>
				<IconButton
					variant="ghost"
					size="m"
					icon={SquareTerminal}
					label={t("shell.workbench.newTerminal")}
					data-testid="new-terminal"
					onClick={() => useAppStore.getState().addTerminal(workspaceId, undefined, groupId)}
					className="shrink-0 self-center"
				/>
			</>
		),
		[canRenameChat, requestRenameChat, t, workspaceId],
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
					const currentAttention = state.layoutAttentionByWorkspace[workspaceId];
					prepared.onAccepted(
						current && currentAttention
							? { document: current, attention: currentAttention }
							: undefined,
					);
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

	if (!rendered) {
		return (
			<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
				{t("shell.workbench.restoringLayout")}
			</div>
		);
	}

	return (
		<div data-testid="workspace-workbench" data-layout-status="settled" className="contents">
			{planSessionIds.map((sessionId) => (
				<PlanSummaryAutoDraft
					key={`plan-summary-draft:${workspaceId}:${sessionId}`}
					workspaceId={workspaceId}
					sessionId={sessionId}
				/>
			))}
			<Workbench
				document={rendered.document}
				catalog={catalog}
				unofferedTools={unofferedTools}
				attention={rendered.attention}
				maxSideGroups={layoutPreferences.maxSideGroups}
				maxBottomGroups={layoutPreferences.maxBottomGroups}
				projectionEpoch={projectionEpoch}
				{...(focusRequest ? { focusRequest } : {})}
				subscribeCloseRequest={subscribeCloseRequest}
				renderTabBody={renderTabBody}
				renderTabIcon={(tab, _active) => {
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
					if (tab.kind === "file" || tab.kind === "diff") {
						const flag = reviewFlagByPath.get(tab.path);
						if (flag) {
							return (
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
							);
						}
					}
					return null;
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
						<WorkspaceChatHistory
							key={workspaceId}
							workspaceId={workspaceId}
							targetGroupId={groupId}
							{...(canRenameChat ? { onRenameChat: requestRenameChat } : {})}
						/>
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
				onDirectTabActivation={(tab) => {
					if (tab.kind === "chat") {
						useAppStore.getState().noteDirectChatActivation(tab.sessionId);
					}
				}}
				readNavigationTick={() => selectWorkspaceNavTick(useAppStore.getState(), workspaceId)}
				{...(canRenameChat ? { onRenameChat: requestRenameChat } : {})}
				chatFirstPrompts={chatFirstPrompts}
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
							const finalState = useAppStore.getState();
							const finalDocument = finalState.layoutDocumentsByWorkspace[workspaceId];
							const finalAttention = finalState.layoutAttentionByWorkspace[workspaceId];
							prepared.onAccepted(
								finalDocument && finalAttention
									? { document: finalDocument, attention: finalAttention }
									: undefined,
							);
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
				onGestureCanceled={() => toast.info(t("shell.workbench.gestureCanceled"))}
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
