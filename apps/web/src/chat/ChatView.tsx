import { RiArrowDownLine as ArrowDown, RiArrowUpLine as ArrowUp } from "@remixicon/react";
import type {
	AskUserQuestionResult,
	ChatMessage,
	PromptContent,
	PromptHit,
	QueueLane,
	SessionQueueContent,
	SlashCommand,
	TemplateInfo,
} from "@thinkrail/contracts";
import { type RefCallback, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Popover, PopoverAnchor, PopoverTrigger } from "@/components/ui/popover";
import {
	EMPTY_RUNTIME,
	SettingsSection,
	selectSkillsStale,
	selectWorkspaceById,
	specPathMatcher,
	toast,
	useAppStore,
} from "@/store";
import { errorText, getTransport } from "@/transport";
import { ActivityBreadcrumbTrail } from "./activityBreadcrumbs";
import { AskStatesContext, deriveAskStates } from "./askState";
import { type ChatActions, ChatActionsContext } from "./ChatActions";
import { ChatHeader } from "./ChatHeader";
import { ChatPlanContent, ChatPlanStripContent } from "./ChatPlan";
import {
	Composer,
	type ComposerHandle,
	type ComposerSubmitDisposition,
	type MentionCandidate,
	type SubmitBehavior,
} from "./Composer";
import { HistoryOverlay } from "./HistoryOverlay";
import type { ChatMessageOrder } from "./messageOrder";
import { planGlance } from "./planView";
import { QueueStrip } from "./QueueStrip";
import { type ChatRow, deriveRows, projectRows, rowIndexForMessage } from "./rows";
import { SkillsDialog } from "./SkillsDialog";
import { StreamIndicator, type StreamStatus, streamStatus } from "./StreamIndicator";
import { SubagentTranscriptDialog } from "./SubagentTranscriptDialog";
import { parseTemplateSlots } from "./slotSession";
import { TemplateEditorDialog } from "./TemplateEditorDialog";
import { shouldApplyTemplatePick } from "./templatePick";
import { stripFrontmatter } from "./templateText";
import { useModelCatalog } from "./useModelCatalog";
import "./tools/register";
import { ChatTurnView } from "./turns";
import type { ChatAttachment } from "./types";
import { useChatScroll } from "./useChatScroll";
import { useChatTodos } from "./useChatTodos";
import { useHistorySearch } from "./useHistorySearch";
import { advanceVirtualRows, initialVirtualRows } from "./virtualRows";

const TRY_AGAIN_PROMPT = "Try again.";

function messageAnchorText(message: ChatMessage): string {
	if (message.role === "user") {
		return message.content
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("\n");
	}
	if (message.role === "assistant") {
		return message.blocks
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("\n");
	}
	return "";
}

function templateToCommand(t: TemplateInfo): SlashCommand {
	return {
		name: t.name,
		...(t.description ? { description: t.description } : {}),
		source: "prompt",
		sourceInfo: {
			path: t.filePath,
			source: "local",
			scope: t.scope === "global" ? "user" : "project",
			origin: "top-level",
		},
	};
}

type ChatListContext = {
	messageOrder: ChatMessageOrder;
	status: StreamStatus | null;
	runwayActive: boolean;
	headerRef: RefCallback<HTMLDivElement>;
	streamEdgeRef: RefCallback<HTMLDivElement>;
	runwayRef: RefCallback<HTMLDivElement>;
};

function StreamHeader({ context }: { context: ChatListContext }) {
	const inset = context.runwayActive ? (
		<div className="h-[clamp(48px,10cqh,80px)]" aria-hidden />
	) : null;
	return (
		<div ref={context.headerRef}>
			{inset}
			{context.messageOrder === "newest-first" && context.status ? (
				<div className="mx-auto max-w-3xl px-12 pb-8">
					<StreamIndicator status={context.status} />
				</div>
			) : null}
		</div>
	);
}

function StreamFooter({ context }: { context: ChatListContext }) {
	if (context.messageOrder === "newest-first") {
		return context.runwayActive ? (
			<div
				ref={context.runwayRef}
				data-testid="chat-stream-runway"
				className="h-[42cqh]"
				aria-hidden
			/>
		) : null;
	}
	if (!context.status && !context.runwayActive) return null;
	return (
		<>
			{context.status ? (
				<div className="mx-auto max-w-3xl px-12 pb-8">
					<StreamIndicator status={context.status} />
				</div>
			) : null}
			{context.runwayActive ? (
				<>
					<div ref={context.streamEdgeRef} data-testid="chat-stream-edge" className="h-0" />
					<div
						ref={context.runwayRef}
						data-testid="chat-stream-runway"
						className="h-[42cqh]"
						aria-hidden
					/>
				</>
			) : null}
		</>
	);
}

const CHAT_LIST_COMPONENTS = { Header: StreamHeader, Footer: StreamFooter };

export default function ChatView({
	sessionId,
	workspaceId,
	onOpenFile,
}: {
	sessionId: string;
	workspaceId: string;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	const runtime = useAppStore((s) => s.sessions[sessionId]) ?? EMPTY_RUNTIME;
	const composerGrowthLimit = useAppStore((state) => state.composerGrowthLimit);
	const chatMessageOrder = useAppStore((state) => state.chatMessageOrder);
	const {
		refreshing: configRefreshing,
		refresh: onRefreshConfig,
		selectOption: onSelectConfigOption,
	} = useModelCatalog(sessionId);
	const projectId = useAppStore(
		(s) =>
			Object.values(s.workspaces)
				.flat()
				.find((w) => w.id === workspaceId)?.projectId,
	);
	const [skillsOpen, setSkillsOpen] = useState(false);
	const skillsStale = useAppStore((s) => selectSkillsStale(s, workspaceId, sessionId));
	const workspaceRoot = useAppStore(
		(s) => selectWorkspaceById(s, workspaceId)?.worktreePath ?? undefined,
	);
	const workspaces = useAppStore((s) => s.workspaces);
	const workspaceNames = useMemo(() => {
		const map: Record<string, string> = {};
		for (const list of Object.values(workspaces)) {
			for (const w of list) map[w.id] = w.name;
		}
		return map;
	}, [workspaces]);
	const specNodes = useAppStore((s) => s.specsByWorkspace[workspaceId]);
	const isSpec = useMemo(() => specPathMatcher(specNodes ?? []), [specNodes]);
	const {
		messages,
		isStreaming,
		configOptions,
		commands,
		usage,
		capabilities,
		retries,
		compacting,
		draft,
		queue,
	} = runtime;

	const chronologicalRows = useMemo(
		() => deriveRows(messages, isStreaming, { retries, compacting }, isSpec),
		[messages, isStreaming, retries, compacting, isSpec],
	);
	const rows = useMemo(
		() => projectRows(chronologicalRows, chatMessageOrder),
		[chronologicalRows, chatMessageOrder],
	);
	const visibleAnchorRowId = useRef<string | null>(null);
	const [storedVirtualRows, setStoredVirtualRows] = useState(() =>
		initialVirtualRows(rows, chatMessageOrder),
	);
	let virtualRows = storedVirtualRows;
	if (storedVirtualRows.rows !== rows || storedVirtualRows.order !== chatMessageOrder) {
		virtualRows = advanceVirtualRows(
			storedVirtualRows,
			rows,
			chatMessageOrder,
			visibleAnchorRowId.current,
		);
		setStoredVirtualRows(virtualRows);
	}
	const firstItemIndex = virtualRows.firstItemIndex;

	const recentPrompts = useMemo(() => {
		const texts = messages
			.filter((m): m is Extract<ChatMessage, { role: "user" }> => m.role === "user" && !m.hidden)
			.map(messageAnchorText)
			.filter(Boolean);
		return [...new Set(texts.reverse())];
	}, [messages]);

	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
	const plan = useChatTodos(workspaceId, sessionId);
	const [planOpen, setPlanOpen] = useState(false);
	const [slashActive, setSlashActive] = useState(false);
	const [templates, setTemplates] = useState<TemplateInfo[]>([]);
	const [templatesEmpty, setTemplatesEmpty] = useState(false);
	const [saveAsTemplateHit, setSaveAsTemplateHit] = useState<PromptHit | null>(null);
	const [transcriptChildId, setTranscriptChildId] = useState<string | null>(null);

	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const latestUserRow = useMemo(() => {
		const row = chronologicalRows.findLast((candidate) => candidate.kind === "user");
		if (!row) return null;
		const index = rows.findIndex((candidate) => candidate.id === row.id);
		return index >= 0 ? { id: row.id, index } : null;
	}, [chronologicalRows, rows]);
	const latestRow = useMemo(() => {
		const index = chatMessageOrder === "newest-first" ? 0 : rows.length - 1;
		const row = rows[index];
		return row ? { id: row.id, index } : null;
	}, [chatMessageOrder, rows]);
	const runwayMarkerRowId =
		chatMessageOrder === "newest-first"
			? (latestUserRow?.id ?? rows[rows.length - 1]?.id ?? null)
			: null;
	const {
		followOutput,
		handleAtBottom,
		handleAtTop,
		handleContentHeight,
		handleScrollerRef,
		headerRef,
		streamEdgeRef,
		runwayEdgeRef,
		runwayRef,
		scrollerElement,
		showScrollButton,
		scrollButtonLabel,
		scrollToLatest,
		releaseFollow,
		runwayActive,
		followState,
		containerProps,
	} = useChatScroll(virtuosoRef, isStreaming, chatMessageOrder, latestUserRow, latestRow);
	const streamPhase = isStreaming ? streamStatus(messages, null) : null;
	const listContext = useMemo<ChatListContext>(
		() => ({
			messageOrder: chatMessageOrder,
			status: streamPhase,
			runwayActive,
			headerRef,
			streamEdgeRef,
			runwayRef,
		}),
		[chatMessageOrder, streamPhase, runwayActive, headerRef, streamEdgeRef, runwayRef],
	);
	const composerRef = useRef<ComposerHandle>(null);
	const askFocusScope = useRef<object>({}).current;

	const {
		state: historyState,
		openOverlay,
		close: closeHistory,
		setQuery,
		cycleScope,
		setScope,
		toggleStage,
		moveSelection,
		openMessage,
	} = useHistorySearch(sessionId, workspaceId, projectId);

	const chatLocationRequest = useAppStore((s) => s.chatLocationRequest);
	const [flashRowId, setFlashRowId] = useState<string | null>(null);

	useEffect(() => {
		getTransport()
			.request("session.getCommands", { sessionId })
			.then((c) =>
				useAppStore.getState().applyChatEvent(sessionId, { type: "commands", commands: c }),
			)
			.catch(() => {});
	}, [sessionId]);

	useEffect(() => {
		if (!slashActive) return;
		let cancelled = false;
		getTransport()
			.request("template.list", { workspaceId })
			.then((res) => {
				if (cancelled) return;
				setTemplates(res.templates);
				setTemplatesEmpty(res.templates.length === 0);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [slashActive, workspaceId]);

	const mergedCommands = useMemo(
		() => [
			...(capabilities.slashCommands ? commands.filter((c) => c.source !== "prompt") : []),
			...templates.map(templateToCommand),
		],
		[commands, templates, capabilities.slashCommands],
	);

	useEffect(() => {
		if (mentionQuery === null) {
			setMentionCandidates([]);
			return;
		}
		const slash = mentionQuery.lastIndexOf("/");
		const dir = slash >= 0 ? mentionQuery.slice(0, slash) : "";
		const prefix = (slash >= 0 ? mentionQuery.slice(slash + 1) : mentionQuery).toLowerCase();
		let cancelled = false;
		const timer = setTimeout(() => {
			getTransport()
				.request("fs.readDir", { workspaceId, path: dir })
				.then((nodes) => {
					if (cancelled) return;
					setMentionCandidates(
						nodes
							.filter((n) => n.name.toLowerCase().startsWith(prefix))
							.slice(0, 12)
							.map((n) => ({ path: n.path, name: n.name, kind: n.kind })),
					);
				})
				.catch(() => {
					if (!cancelled) setMentionCandidates([]);
				});
		}, 120);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [mentionQuery, workspaceId]);

	const onMentionQuery = useCallback((q: string | null) => setMentionQuery(q), []);

	const restoreTextToDraft = (text: string) => {
		if (!text.trim()) return;
		const current = useAppStore.getState().sessions[sessionId]?.draft ?? "";
		const combined = [text, current].filter((t) => t.trim()).join("\n\n");
		useAppStore.getState().setChatDraft(sessionId, combined);
		composerRef.current?.refocus();
	};

	const restoreQueueContentToDraft = (content: SessionQueueContent): void => {
		const queued = [...content.steering, ...content.followUp];
		const text = queued
			.map((blocks) =>
				blocks
					.filter((block) => block.type === "text")
					.map((block) => block.text)
					.join(""),
			)
			.filter(Boolean)
			.join("\n\n");
		restoreTextToDraft(text);
		const images = queued.flatMap((blocks) => blocks.filter((block) => block.type === "image"));
		composerRef.current?.restoreAttachments(
			images.map((image, index) => ({
				name: `queued-image-${index + 1}`,
				content: image,
			})),
		);
	};

	const _drainQueueToDraft = async (): Promise<void> => {
		const content = await getTransport().request("session.clearQueue", {
			sessionId,
			requireTextOnly: true,
		});
		restoreQueueContentToDraft(content);
	};

	const performSend = (
		text: string,
		attachments: ChatAttachment[],
		behavior: Exclude<SubmitBehavior, "interrupt">,
	) => {
		const content: PromptContent[] = [
			...(text ? [{ type: "text" as const, text }] : []),
			...attachments.map((a) => a.content),
		];
		if (content.length === 0) return;
		const method =
			behavior === "steer"
				? "session.steer"
				: behavior === "followUp"
					? "session.followUp"
					: "session.prompt";
		getTransport()
			.request(method, { sessionId, content })
			.then(({ messageId }) => {
				const message: ChatMessage = {
					role: "user",
					id: messageId,
					timestamp: Date.now(),
					content,
				};
				useAppStore.getState().applyChatEvent(sessionId, { type: "message_start", message });
			})
			.catch((err) => {
				useAppStore.getState().appendNotice(sessionId, "error", errorText(err));
				restoreTextToDraft(text);
			});
	};

	const onSubmit = (
		text: string,
		attachments: ChatAttachment[],
		behavior: SubmitBehavior,
	): ComposerSubmitDisposition => {
		if (behavior !== "interrupt") {
			performSend(text, attachments, behavior);
			return { accepted: true };
		}
		getTransport()
			.request("session.abort", { sessionId })
			.then(() => performSend(text, attachments, "send"))
			.catch((err) => {
				useAppStore.getState().appendNotice(sessionId, "error", errorText(err));
				restoreTextToDraft(text);
			});
		return { accepted: true };
	};

	const removeQueued = (kind: QueueLane, index: number) =>
		getTransport().request("session.removeQueued", { sessionId, kind, index });

	const onEditQueued = (kind: QueueLane, index: number) =>
		void removeQueued(kind, index)
			.then(({ removed }) => {
				if (removed === null) return;
				restoreQueueContentToDraft({ steering: [removed], followUp: [] });
			})
			.catch(() => {});

	const onRemoveQueued = (kind: QueueLane, index: number) =>
		void removeQueued(kind, index).catch(() => {});

	const onAbort = () => {
		void getTransport()
			.request("session.abort", { sessionId, restoreQueue: true })
			.then(({ restoredQueue }) => {
				if (restoredQueue) restoreQueueContentToDraft(restoredQueue);
			})
			.catch(() => {});
	};

	const onHistoryOpen = () => openOverlay(draft);

	const onManageTemplates = () => useAppStore.getState().openSettings(SettingsSection.Templates);

	const onDismissHistory = () => {
		closeHistory();
		composerRef.current?.refocus();
	};

	const onInsertHit = (hit: PromptHit) => {
		composerRef.current?.insertText(hit.text);
		closeHistory();
	};

	const onInsertAndSendHit = (hit: PromptHit) => {
		composerRef.current?.insertAndSubmit(hit.text, isStreaming ? "followUp" : "send");
		closeHistory();
	};

	const onSaveAsTemplateHit = (hit: PromptHit) => {
		closeHistory();
		setSaveAsTemplateHit(hit);
	};

	const onDeleteHistoryChat = async (targetWorkspaceId: string, targetSessionId: string) => {
		try {
			await getTransport().request("session.delete", {
				workspaceId: targetWorkspaceId,
				sessionId: targetSessionId,
			});
			closeHistory();
			useAppStore.getState().deleteChat(targetWorkspaceId, targetSessionId);
		} catch (err) {
			toast.error(errorText(err), "Couldn't delete the chat");
		}
	};

	const pickGeneration = useRef(0);
	const onPickTemplate = useCallback(
		(name: string) => {
			const generation = ++pickGeneration.current;
			const draftAtPick = useAppStore.getState().sessions[sessionId]?.draft ?? "";
			getTransport()
				.request("template.get", { workspaceId, name })
				.then((t) => {
					const apply = shouldApplyTemplatePick({
						generation,
						latestGeneration: pickGeneration.current,
						draftAtPick,
						currentDraft: useAppStore.getState().sessions[sessionId]?.draft ?? "",
					});
					if (!apply) return;
					const parsed = parseTemplateSlots(stripFrontmatter(t.content), t.argumentHint);
					composerRef.current?.insertTemplate(parsed);
				})
				.catch(() => {});
		},
		[workspaceId, sessionId],
	);

	useEffect(() => {
		if (
			!chatLocationRequest ||
			chatLocationRequest.workspaceId !== workspaceId ||
			chatLocationRequest.sessionId !== sessionId ||
			rows.length === 0
		) {
			return;
		}
		if (useAppStore.getState().chatLocationRequest !== chatLocationRequest) return;
		const { messageId, anchorText } = chatLocationRequest;
		const prefix = anchorText.slice(0, 40);
		const target = messages.find((m) => m.id === messageId);
		const resolved =
			target && messageAnchorText(target).includes(prefix)
				? target
				: messages.findLast((m) => messageAnchorText(m).includes(prefix));
		const index = resolved ? rowIndexForMessage(rows, resolved.id) : -1;
		if (index === -1) {
			toast.error("couldn't locate the message — the session may have changed");
			useAppStore.getState().clearChatLocation();
			return;
		}
		releaseFollow();
		virtuosoRef.current?.scrollToIndex({ index, align: "center" });
		setFlashRowId(rows[index]?.id ?? null);
		useAppStore.getState().clearChatLocation();
	}, [chatLocationRequest, sessionId, rows, messages, workspaceId]);

	const historyOpenRequest = useAppStore((s) => s.historyOpenRequest);
	const historyOverlayOpen = historyState.open;
	useEffect(() => {
		if (historyOpenRequest?.sessionId !== sessionId) return;
		if (useAppStore.getState().historyOpenRequest !== historyOpenRequest) return;
		useAppStore.getState().clearHistoryOpen();
		if (historyOverlayOpen) cycleScope();
		else composerRef.current?.openHistory();
	}, [historyOpenRequest, sessionId, historyOverlayOpen, cycleScope]);

	useEffect(() => {
		if (flashRowId === null) return;
		const timer = setTimeout(() => setFlashRowId(null), 1600);
		return () => clearTimeout(timer);
	}, [flashRowId]);

	const onOpenChange = useCallback(
		(path: string) => {
			useAppStore.getState().requestChangesView(workspaceId, path);
		},
		[workspaceId],
	);

	const onOpenSpec = useCallback(
		(path: string) => {
			useAppStore.getState().requestSpecView(workspaceId, path);
		},
		[workspaceId],
	);

	const onReveal = useCallback(
		(tool: "specs" | "changes") => {
			useAppStore.getState().requestToolView(workspaceId, tool);
		},
		[workspaceId],
	);

	const askStates = useMemo(() => deriveAskStates(messages), [messages]);
	const askContext = useMemo(
		() => ({ states: askStates, focusScope: askFocusScope }),
		[askStates, askFocusScope],
	);

	const planGlanceState = useMemo(
		() => planGlance(isStreaming, askStates),
		[isStreaming, askStates],
	);

	const chatActions = useMemo<ChatActions>(
		() => ({
			answerQuestion: (toolCallId: string, result: AskUserQuestionResult) =>
				getTransport()
					.request("session.answerQuestion", { sessionId, toolCallId, result })
					.then(() => undefined),
			focusComposer: () => composerRef.current?.refocus(),
			openSubagentTranscript: setTranscriptChildId,
		}),
		[sessionId],
	);

	return (
		<ChatActionsContext.Provider value={chatActions}>
			<AskStatesContext.Provider value={askContext}>
				<div
					data-testid="chat-view"
					data-message-order={chatMessageOrder}
					className="flex h-full min-h-0 min-w-0 flex-col bg-container-workspace-bg [container-type:size]"
				>
					<Popover open={planOpen} onOpenChange={setPlanOpen}>
						<PopoverAnchor asChild>
							<div className="shrink-0">
								<ChatHeader
									usage={usage}
									capabilities={capabilities}
									agent={capabilities.agent}
									left={
										plan.data ? (
											<PopoverTrigger asChild>
												<button
													type="button"
													data-testid="chat-plan-toggle"
													data-open={planOpen}
													className="flex min-w-0 max-w-full items-center gap-4 overflow-clip whitespace-nowrap text-text-muted tr-text-metadata hover:text-text-default"
												>
													<ChatPlanStripContent
														plan={plan}
														open={planOpen}
														glance={planGlanceState}
													/>
												</button>
											</PopoverTrigger>
										) : null
									}
									skillsStale={skillsStale}
									{...(projectId && capabilities.skills
										? { onOpenSkills: () => setSkillsOpen(true) }
										: {})}
								/>
							</div>
						</PopoverAnchor>
						<ChatPlanContent plan={plan} glance={planGlanceState} />
					</Popover>
					<div
						data-testid="chat-scroll"
						data-follow-state={followState}
						data-latest-edge={chatMessageOrder === "newest-first" ? "top" : "bottom"}
						data-streaming={isStreaming}
						className="relative flex min-h-0 flex-1 flex-col [container-type:size]"
						{...containerProps}
					>
						<Virtuoso<ChatRow, ChatListContext>
							key={chatMessageOrder}
							ref={virtuosoRef}
							data={rows}
							firstItemIndex={firstItemIndex}
							scrollerRef={handleScrollerRef}
							context={listContext}
							components={CHAT_LIST_COMPONENTS}
							className="min-h-0 flex-1 overflow-x-hidden"
							initialTopMostItemIndex={
								chatMessageOrder === "newest-first"
									? { index: 0, align: "start" }
									: { index: Math.max(rows.length - 1, 0), align: "end" }
							}
							followOutput={followOutput}
							atBottomStateChange={handleAtBottom}
							atTopStateChange={handleAtTop}
							rangeChanged={({ startIndex }) => {
								const localIndex = startIndex - firstItemIndex;
								visibleAnchorRowId.current = rows[localIndex]?.id ?? null;
							}}
							totalListHeightChanged={handleContentHeight}
							atBottomThreshold={50}
							atTopThreshold={50}
							computeItemKey={(_, row) => row.id}
							itemContent={(index, row) => (
								<div
									data-flash={row.id === flashRowId || undefined}
									className="mx-auto max-w-3xl rounded-[var(--radius-sm)] px-12 py-4 transition-colors data-[flash]:bg-primary-subtle"
								>
									<ChatTurnView
										row={row}
										workspaceRoot={workspaceRoot}
										onOpenFile={onOpenFile}
										onOpenSpec={onOpenSpec}
										onOpenChange={onOpenChange}
										onReveal={onReveal}
										onTryAgain={() => performSend(TRY_AGAIN_PROMPT, [], "send")}
									/>
									{chatMessageOrder === "newest-first" &&
									runwayActive &&
									index === firstItemIndex ? (
										<div ref={streamEdgeRef} data-testid="chat-stream-edge" className="h-0" />
									) : null}
									{chatMessageOrder === "newest-first" &&
									runwayActive &&
									row.id === runwayMarkerRowId ? (
										<div ref={runwayEdgeRef} data-testid="chat-runway-edge" className="h-0" />
									) : null}
								</div>
							)}
						/>
						<ActivityBreadcrumbTrail scroller={scrollerElement} />
						{showScrollButton ? (
							<button
								type="button"
								data-testid={
									chatMessageOrder === "newest-first" ? "scroll-to-top" : "scroll-to-bottom"
								}
								onClick={scrollToLatest}
								className="-translate-x-1/2 absolute bottom-12 left-1/2 flex items-center gap-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-8 py-4 text-text-muted tr-text-metadata shadow-[var(--shadow-md)] hover:bg-control-bg-hovered hover:text-text-default"
							>
								{chatMessageOrder === "newest-first" ? (
									<ArrowUp className="size-12" />
								) : (
									<ArrowDown className="size-12" />
								)}
								{scrollButtonLabel}
							</button>
						) : null}
					</div>
					{queue.messages ? (
						<QueueStrip queue={queue.messages} onEdit={onEditQueued} onRemove={onRemoveQueued} />
					) : null}
					<div className="relative shrink-0">
						<HistoryOverlay
							state={historyState}
							workspaceNames={workspaceNames}
							onQueryChange={setQuery}
							onSetScope={setScope}
							onToggleStage={toggleStage}
							onMoveSelection={moveSelection}
							onClose={onDismissHistory}
							onInsert={onInsertHit}
							onInsertAndSend={onInsertAndSendHit}
							onOpenMessage={openMessage}
							onSaveAsTemplate={onSaveAsTemplateHit}
							onDeleteChat={(wsId, id) => void onDeleteHistoryChat(wsId, id)}
						/>
						<Composer
							ref={composerRef}
							value={draft}
							onChange={(v) => useAppStore.getState().setChatDraft(sessionId, v)}
							isStreaming={isStreaming}
							growthLimit={composerGrowthLimit}
							commands={mergedCommands}
							mentionCandidates={mentionCandidates}
							recentPrompts={recentPrompts}
							configOptions={configOptions}
							configCapabilities={capabilities}
							configRefreshing={configRefreshing}
							onRefreshConfig={onRefreshConfig}
							onSelectConfigOption={onSelectConfigOption}
							onMentionQuery={onMentionQuery}
							onSlashActive={setSlashActive}
							onSubmit={onSubmit}
							onAbort={onAbort}
							onHistoryOpen={onHistoryOpen}
							onPickTemplate={onPickTemplate}
							onManageTemplates={onManageTemplates}
							templatesEmpty={templatesEmpty}
						/>
					</div>
					<TemplateEditorDialog
						open={saveAsTemplateHit != null}
						onOpenChange={(open) => {
							if (!open) setSaveAsTemplateHit(null);
						}}
						workspaceId={workspaceId}
						initialBody={saveAsTemplateHit?.text ?? ""}
					/>
					{transcriptChildId ? (
						<SubagentTranscriptDialog
							workspaceId={workspaceId}
							parentSessionId={sessionId}
							childSessionId={transcriptChildId}
							onOpenChange={(open) => {
								if (!open) setTranscriptChildId(null);
							}}
						/>
					) : null}
					{projectId ? (
						<SkillsDialog
							projectId={projectId}
							workspace={{
								workspaceId,
								sessionId,
								streaming: isStreaming,
								stale: skillsStale,
								onReloaded: (syncedTick) =>
									useAppStore.getState().markSkillsSynced(sessionId, syncedTick),
							}}
							open={skillsOpen}
							onOpenChange={setSkillsOpen}
						/>
					) : null}
				</div>
			</AskStatesContext.Provider>
		</ChatActionsContext.Provider>
	);
}
