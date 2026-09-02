import {
	RiArrowDownSLine as ChevronDown,
	RiFolderLine as FolderLine,
	RiListCheck2 as PlanIcon,
	RiLoader4Line as TodoActive,
	RiCheckboxCircleFill as TodoDone,
	RiCheckboxBlankCircleLine as TodoPending,
} from "@remixicon/react";
import type {
	AgentTodoItem,
	TerminalDataPush,
	TerminalDetachedPush,
	TerminalExitPush,
} from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebFontsAddon } from "@xterm/addon-web-fonts";
import { type ITheme, Terminal as XTerm } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { type QuietScrollEdges, QuietScrollFrame } from "@/components/QuietScrollArea";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	CLAUDE_EFFORT_LEVELS,
	CLAUDE_MODELS,
	type ClaudeEffortLevel,
	cssColorToHex,
	driveEffortPicker,
	driveModelPicker,
	type ModelPickerIo,
	type ModelPickerOutcome,
} from "@/lib";
import { tupleKey } from "@/lib/utils";
import {
	type ClaudeCodeSessionState,
	embeddedHostKey,
	selectClaudeCodeStatus,
	selectWorkspaceById,
	useAppStore,
} from "../store";
import { onThemeSwap } from "../themes";
import { getTransport } from "../transport";
import { createExtendedKeyState } from "./extendedKeys";
import { createPtySizeSync, runAfterTerminalRelayout } from "./ptySizeSync";
import { TerminalAttachFile } from "./TerminalAttachFile";
import { stripAnsiDim, terminalContrastFloor } from "./terminalContrast";
import { attachPath, cwdLabel } from "./terminalCwd";
import { createTerminalPrebindBuffer } from "./terminalPrebindBuffer";

const RESIZE_DEBOUNCE_MS = 60;

const RELAYOUT_TIMEOUT_MS = 4000;

/**
 * A model id is long and mostly prefix; the part that identifies it is what fits in a chip, with the id
 * itself on hover. Effort is shown as the agent words it.
 */
function agentFacts(
	state: ClaudeCodeSessionState | undefined,
): { kind: string; label: string; title: string }[] {
	if (!state) return [];
	const facts: { kind: string; label: string; title: string }[] = [];
	const directory = cwdLabel(state.cwd);
	if (directory && state.cwd) {
		facts.push({ kind: "cwd", label: directory, title: `Claude started in ${state.cwd}` });
	}
	if (state.model) {
		facts.push({
			kind: "model",
			label: state.model.replace(/^claude-/, "").replace(/-\d{8}$/, ""),
			title: state.model,
		});
	}
	if (state.effort) {
		facts.push({ kind: "effort", label: `${state.effort} effort`, title: "Reasoning effort" });
	}
	return facts;
}

function sendTerminalWrite(send: Promise<unknown>): void {
	void send.catch(() => {});
}

const PICKER_TAIL_LINES = 48;

function terminalTail(term: XTerm): string[] {
	const buffer = term.buffer.active;
	const start = Math.max(0, buffer.length - PICKER_TAIL_LINES);
	const lines: string[] = [];
	for (let i = start; i < buffer.length; i++) {
		lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
	}
	return lines;
}

function TerminalPlan({ todos }: { todos: readonly AgentTodoItem[] }) {
	const [open, setOpen] = useState(false);
	const done = todos.filter((todo) => todo.status === "completed").length;
	return (
		<>
			<button
				type="button"
				data-testid="terminal-plan-toggle"
				aria-expanded={open}
				title={open ? "Hide Claude's plan" : "Show Claude's plan"}
				onClick={() => setOpen((current) => !current)}
				className="flex shrink-0 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] bg-container-elevated-bg px-4 tr-text-label-pill text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			>
				<PlanIcon className="size-12 shrink-0" />
				<span>
					{done}/{todos.length}
				</span>
			</button>
			{open ? (
				<div
					data-testid="terminal-plan"
					className="absolute inset-x-12 bottom-32 z-20 max-h-[50%] overflow-auto rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg p-8"
				>
					<ul className="flex flex-col gap-4">
						{todos.map((todo, index) => (
							<li
								key={`${index}-${todo.content}`}
								data-testid="terminal-plan-item"
								data-status={todo.status}
								className={`flex items-start gap-8 tr-text-metadata ${
									todo.status === "in_progress" ? "text-text-default" : "text-text-muted"
								}`}
							>
								{todo.status === "completed" ? (
									<TodoDone className="mt-2 size-12 shrink-0 text-feedback-success" />
								) : todo.status === "in_progress" ? (
									<TodoActive className="mt-2 size-12 shrink-0 animate-spin text-primary" />
								) : (
									<TodoPending className="mt-2 size-12 shrink-0" />
								)}
								<span className={todo.status === "completed" ? "line-through opacity-70" : ""}>
									{todo.status === "in_progress" && todo.activeForm
										? todo.activeForm
										: todo.content}
								</span>
							</li>
						))}
					</ul>
				</div>
			) : null}
		</>
	);
}

const IME_SENTINEL_KEYCODE = 229;

// xterm #6065: an active IME reports keyCode 229, so xterm's chord table drops Ctrl+<letter>/Escape — see panels/SPEC.md.
function imeControlBytes(event: KeyboardEvent): string | null {
	if (event.altKey || event.metaKey) return null;
	if (event.code === "Escape") return "\x1b";
	if (!event.ctrlKey) return null;
	const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
	return letter ? String.fromCharCode(letter.charCodeAt(0) - 64) : null;
}

function cssVar(name: string): string | undefined {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
}

function cssColorVar(name: string): string | undefined {
	return cssColorToHex(cssVar(name) ?? "") || undefined;
}

const ANSI_TOKENS = [
	["black", "--ansi-black"],
	["red", "--ansi-red"],
	["green", "--ansi-green"],
	["yellow", "--ansi-yellow"],
	["blue", "--ansi-blue"],
	["magenta", "--ansi-magenta"],
	["cyan", "--ansi-cyan"],
	["white", "--ansi-white"],
	["brightBlack", "--ansi-bright-black"],
	["brightRed", "--ansi-bright-red"],
	["brightGreen", "--ansi-bright-green"],
	["brightYellow", "--ansi-bright-yellow"],
	["brightBlue", "--ansi-bright-blue"],
	["brightMagenta", "--ansi-bright-magenta"],
	["brightCyan", "--ansi-bright-cyan"],
	["brightWhite", "--ansi-bright-white"],
] as const;

function isHighContrast(): boolean {
	return document.documentElement.dataset.themeContrast === "high";
}

function contrastFloor(): number {
	return terminalContrastFloor(isHighContrast());
}

function readTheme(): ITheme {
	const theme: ITheme = {};
	const bg = cssColorVar("--container-terminal-bg");
	if (bg) theme.background = bg;
	const fg = cssColorVar("--text-default");
	if (fg) theme.foreground = fg;
	const cursor = cssColorVar("--primary");
	if (cursor) theme.cursor = cursor;
	const sel = cssColorVar("--editor-selection-bg");
	if (sel) theme.selectionBackground = sel;
	const selFg = cssColorVar("--editor-selection-text");
	if (selFg) theme.selectionForeground = selFg;
	for (const [slot, name] of ANSI_TOKENS) {
		const color = cssColorVar(name);
		if (color) theme[slot] = color;
	}
	return theme;
}

function tryLoad(fn: () => void): void {
	try {
		fn();
	} catch {}
}

interface Props {
	tabKey: string;
	workspaceId: string;
	initialCommand?: string;
}

export default function TerminalInstance({ tabKey, workspaceId, initialCommand }: Props) {
	const hostRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<XTerm | null>(null);
	const serverIdRef = useRef<string | null>(null);
	const fitFnRef = useRef<(() => void) | null>(null);
	const reattachRef = useRef<(() => void) | null>(null);
	const initialCommandRef = useRef(initialCommand);
	const queuedInput = useAppStore(
		(state) => state.terminalInputByWorkspace[tupleKey(workspaceId, tabKey)],
	);

	// ThinkRail speaks to an agent running in this terminal — a spec reconcile, say — and only the
	// component holding the attachment knows the server id to write to. See panels/SPEC.md.
	useEffect(() => {
		const id = serverIdRef.current;
		if (!queuedInput || !id) return;
		const text = useAppStore.getState().consumeTerminalInput(workspaceId, tabKey);
		if (text) void getTransport().request("terminal.write", { id, data: `${text}\r` });
	}, [queuedInput, tabKey, workspaceId]);
	// Read through a ref: the key handler is installed once, and which agent runs here changes later.
	const agentNewline = useAppStore(
		(state) =>
			(state.terminalsByWorkspace[workspaceId] ?? []).find((tab) => tab.tabKey === tabKey)
				?.agent === "claude",
	);
	const agentNewlineRef = useRef(agentNewline);
	agentNewlineRef.current = agentNewline;
	const [ready, setReady] = useState(false);
	const [exited, setExited] = useState(false);
	const [failed, setFailed] = useState(false);
	const [detached, setDetached] = useState(false);
	const [scrollEdges, setScrollEdges] = useState<QuietScrollEdges>({
		top: false,
		right: false,
		bottom: false,
		left: false,
	});

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		const term = new XTerm({
			allowProposedApi: true,
			cursorBlink: true,
			fontSize: Number.parseFloat(cssVar("--tr-font-size-s13") ?? "") || 13,
			fontFamily: cssVar("--tr-font-family-code") ?? "monospace",
			theme: readTheme(),
			minimumContrastRatio: contrastFloor(),
			scrollback: 5000,
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		tryLoad(() => {
			term.loadAddon(new Unicode11Addon());
			term.unicode.activeVersion = "11";
		});
		tryLoad(() => term.loadAddon(new ClipboardAddon()));
		const webFonts = new WebFontsAddon(false);
		tryLoad(() => term.loadAddon(webFonts));
		termRef.current = term;
		term.open(host);
		const updateScrollEdges = () => {
			const buffer = term.buffer.active;
			const next = {
				top: buffer.viewportY > 0,
				right: false,
				bottom: buffer.viewportY < buffer.baseY,
				left: false,
			};
			setScrollEdges((current) =>
				current.top === next.top && current.bottom === next.bottom ? current : next,
			);
		};
		const onViewportScroll = term.onScroll(updateScrollEdges);
		const onBufferWrite = term.onWriteParsed(updateScrollEdges);
		const onTerminalResize = term.onResize(updateScrollEdges);
		updateScrollEdges();

		// Extended keys, negotiated rather than assumed: xterm.js implements neither the kitty keyboard
		// protocol nor modifyOtherKeys, so a program that asks to tell Shift+Enter from Enter is answered
		// here — and nothing unusual is sent to a program that never asked. See panels/SPEC.md.
		const extendedKeys = createExtendedKeyState();
		const kittyPush = term.parser.registerCsiHandler({ prefix: ">", final: "u" }, (params) => {
			extendedKeys.pushKitty(typeof params[0] === "number" ? params[0] : 1);
			return true;
		});
		const kittyPop = term.parser.registerCsiHandler({ prefix: "<", final: "u" }, () => {
			extendedKeys.popKitty();
			return true;
		});
		const modifyOtherKeys = term.parser.registerCsiHandler(
			{ prefix: ">", final: "m" },
			(params) => {
				if (params[0] !== 4) return false;
				extendedKeys.setModifyOtherKeys(typeof params[1] === "number" ? params[1] : 0);
				return true;
			},
		);

		term.attachCustomKeyEventHandler((event) => {
			if (event.type === "keydown" && !event.isComposing) {
				const bytes = extendedKeys.encode(event, { agentNewline: agentNewlineRef.current });
				if (bytes !== null) {
					// Returning false tells xterm not to process the key — which also skips the
					// preventDefault it would have done, so the browser was still moving focus on Tab.
					// Anything handled here is handled entirely here.
					event.preventDefault();
					event.stopPropagation();
					const id = serverIdRef.current;
					if (id) sendTerminalWrite(getTransport().request("terminal.write", { id, data: bytes }));
					return false;
				}
			}
			if (event.type !== "keydown" || event.keyCode !== IME_SENTINEL_KEYCODE) return true;
			if (event.isComposing) return true;
			const bytes = imeControlBytes(event);
			if (bytes === null) return true;
			const id = serverIdRef.current;
			if (id) sendTerminalWrite(getTransport().request("terminal.write", { id, data: bytes }));
			return false;
		});

		// OSC 0/2: the program in the tab naming itself. Claude Code sets it to the session's task, which
		// is what makes a terminal tab say what it is doing rather than "Terminal 3". See panels/SPEC.md.
		let reportedTitle: string | null = null;
		const onTitle = term.onTitleChange((title) => {
			if (title === reportedTitle) return;
			reportedTitle = title;
			void getTransport()
				.request("terminal.rename", { workspaceId, tabKey, title })
				.catch(() => {});
		});

		const sizeSync = createPtySizeSync(({ cols, rows }) => {
			const id = serverIdRef.current;
			if (!id) return Promise.reject(new Error("terminal is no longer live"));
			return getTransport().request("terminal.resize", { id, cols, rows });
		});
		const applyFit = (): void => {
			if (host.clientWidth === 0 || host.clientHeight === 0) return;
			tryLoad(() => fit.fit());
			if (!serverIdRef.current) return;
			sizeSync.request({ cols: term.cols, rows: term.rows });
		};

		let fitTimer: ReturnType<typeof setTimeout> | undefined;
		const scheduleFit = (): void => {
			clearTimeout(fitTimer);
			fitTimer = setTimeout(applyFit, RESIZE_DEBOUNCE_MS);
		};

		fitFnRef.current = applyFit;
		applyFit();
		requestAnimationFrame(applyFit);

		let prebind = createTerminalPrebindBuffer();
		const writeOutput = (data: string, cb?: () => void): void =>
			term.write(isHighContrast() ? stripAnsiDim(data) : data, cb);
		const writeTruncation = (): void => term.write("\r\n[output truncated]\r\n");
		const writeFrame = (ev: TerminalDataPush): void => {
			if (ev.truncated) writeTruncation();
			writeOutput(ev.data);
		};
		const unsubscribe = getTransport().subscribe(WS_CHANNELS.terminalData, (payload) => {
			const ev = payload as TerminalDataPush;
			if (prebind.acceptData(ev)) return;
			if (ev.id === serverIdRef.current) writeFrame(ev);
		});
		const onData = term.onData((data) => {
			const id = serverIdRef.current;
			if (id) sendTerminalWrite(getTransport().request("terminal.write", { id, data }));
		});

		let attachGeneration = 0;

		const handleExit = (ev: TerminalExitPush): void => {
			if (ev.id !== serverIdRef.current) return;
			serverIdRef.current = null;
			term.write(`\r\n[process exited${ev.exitCode === 0 ? "" : ` with code ${ev.exitCode}`}]\r\n`);
			setExited(true);
		};
		const unsubscribeExit = getTransport().subscribe(WS_CHANNELS.terminalExit, (payload) => {
			const ev = payload as TerminalExitPush;
			if (prebind.acceptExit(ev)) return;
			handleExit(ev);
		});
		const unsubscribeDetached = getTransport().subscribe(
			WS_CHANNELS.terminalDetached,
			(payload) => {
				const ev = payload as TerminalDetachedPush;
				if (ev.workspaceId !== workspaceId || ev.tabKey !== tabKey) return;
				serverIdRef.current = null;
				attachGeneration += 1;
				setReady(false);
				setDetached(true);
			},
		);

		let disposed = false;

		const attach = (): void => {
			const spawnedAt = { cols: term.cols, rows: term.rows };
			const startedAt = attachGeneration;
			prebind.stop();
			const attemptPrebind = createTerminalPrebindBuffer();
			prebind = attemptPrebind;
			void getTransport()
				.request("terminal.attach", { workspaceId, tabKey, ...spawnedAt })
				.then(({ id, created, replay, prefill, prefillSubmit }) => {
					if (disposed) return;
					if (attachGeneration !== startedAt || prebind !== attemptPrebind) {
						attemptPrebind.stop();
						return;
					}
					const finishAttach = (): void => {
						if (disposed || attachGeneration !== startedAt || prebind !== attemptPrebind) {
							attemptPrebind.stop();
							return;
						}
						sizeSync.acknowledge(spawnedAt);
						serverIdRef.current = id;
						const buffered = attemptPrebind.bind(id);
						if (buffered.truncated) writeTruncation();
						for (const ev of buffered.frames) writeFrame(ev);
						setDetached(false);
						setExited(false);
						setReady(true);
						if (buffered.exit) handleExit(buffered.exit);
						applyFit();
						// Typed, never submitted: the user decides whether to spend a resume — unless the
						// surface that owns this terminal promised to bring its agent back. See SPEC.md.
						if (prefill && serverIdRef.current === id) {
							sendTerminalWrite(
								getTransport().request("terminal.write", {
									id,
									data: prefillSubmit ? `${prefill}\r` : prefill,
								}),
							);
						}
						if (created && serverIdRef.current === id && initialCommandRef.current) {
							sendTerminalWrite(
								getTransport().request("terminal.write", {
									id,
									data: `${initialCommandRef.current}\r`,
								}),
							);
							initialCommandRef.current = undefined;
							useAppStore.getState().consumeTerminalInitialCommand(workspaceId, tabKey);
						}
					};
					if (replay) writeOutput(replay, finishAttach);
					else finishAttach();
				})
				.catch(() => {
					if (disposed || attachGeneration !== startedAt || prebind !== attemptPrebind) {
						attemptPrebind.stop();
						return;
					}
					attemptPrebind.stop();
					term.write("\r\n[could not start a shell — close this tab and open a new one]\r\n");
					setFailed(true);
				});
		};
		reattachRef.current = attach;
		void runAfterTerminalRelayout(
			() => webFonts.relayout(),
			() => {
				if (disposed) return;
				applyFit();
				attach();
			},
			{
				timeoutMs: RELAYOUT_TIMEOUT_MS,
				onTimeout: () => webFonts.dispose(),
			},
		);

		const resizeObserver = new ResizeObserver(scheduleFit);
		resizeObserver.observe(host);

		const stopThemeWatch = onThemeSwap(() => {
			term.options.theme = readTheme();
			term.options.minimumContrastRatio = contrastFloor();
		});

		return () => {
			disposed = true;
			reattachRef.current = null;
			prebind.stop();
			sizeSync.dispose();
			clearTimeout(fitTimer);
			resizeObserver.disconnect();
			stopThemeWatch();
			onData.dispose();
			onViewportScroll.dispose();
			onBufferWrite.dispose();
			onTerminalResize.dispose();
			onTitle.dispose();
			kittyPush.dispose();
			kittyPop.dispose();
			modifyOtherKeys.dispose();
			unsubscribe();
			unsubscribeExit();
			unsubscribeDetached();
			serverIdRef.current = null;
			term.dispose();
		};
	}, [tabKey, workspaceId]);

	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			fitFnRef.current?.();
			termRef.current?.scrollToBottom();
			const active = globalThis.document.activeElement;
			const claimed =
				active !== null &&
				active !== globalThis.document.body &&
				!hostRef.current?.contains(active);
			if (!claimed) termRef.current?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, []);

	const takeBack = useCallback(() => reattachRef.current?.(), []);
	// What the agent in this terminal is running on. Per terminal, because two Claude sessions in two
	// tabs are two chats, on whatever each was last told to use — see panels/SPEC.md.
	const claudeCodeEnabled = useAppStore((state) => state.claudeCodeEnabled);
	const claudeCode = useAppStore((state) => selectClaudeCodeStatus(state, workspaceId, tabKey));
	const claudeHere = claudeCodeEnabled && claudeCode !== undefined;
	const worktreePath = useAppStore(
		(state) => selectWorkspaceById(state, workspaceId)?.worktreePath,
	);
	const facts = claudeCodeEnabled ? agentFacts(claudeCode) : [];
	const cwd = claudeCode?.cwd;
	const attach = useCallback(
		(path: string) => {
			const id = serverIdRef.current;
			if (!id) return;
			const data = `@${attachPath(path, worktreePath, cwd)} `;
			sendTerminalWrite(getTransport().request("terminal.write", { id, data }));
		},
		[cwd, worktreePath],
	);
	const pushToast = useAppStore((state) => state.pushToast);
	const driving = useRef(false);
	const drivePicker = useCallback(
		(
			what: "model" | "effort",
			choice: string,
			drive: (io: ModelPickerIo, choice: string) => Promise<ModelPickerOutcome>,
		) => {
			const id = serverIdRef.current;
			const term = termRef.current;
			if (!id || !term || driving.current) return;
			driving.current = true;
			void drive(
				{
					write: (data) =>
						sendTerminalWrite(getTransport().request("terminal.write", { id, data })),
					readLines: () => terminalTail(term),
					delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
				},
				choice,
			).then((outcome) => {
				driving.current = false;
				if (outcome === "switched") return;
				pushToast({
					variant: "error",
					title: `Couldn't switch the ${what}`,
					message:
						outcome === "no-picker"
							? `Claude Code didn't open its ${what} picker — is the session waiting at its prompt?`
							: `The ${what} picker didn't offer ${choice}.`,
				});
			});
		},
		[pushToast],
	);
	const switchModel = useCallback(
		(model: string) => drivePicker("model", model, driveModelPicker),
		[drivePicker],
	);
	const switchEffort = useCallback(
		(level: ClaudeEffortLevel) =>
			drivePicker("effort", level, (io, choice) =>
				driveEffortPicker(io, choice as ClaudeEffortLevel),
			),
		[drivePicker],
	);

	const hostKey = embeddedHostKey("terminal", tabKey);
	const visualization = useAppStore((s) => s.visualizationsByTerminal[workspaceId]?.[tabKey]);

	useEffect(() => {
		if (visualization) return;
		let stale = false;
		getTransport()
			.request("visualization.get", { workspaceId, tabKey })
			.then((fetched) => {
				if (stale || !fetched) return;
				const store = useAppStore.getState();
				store.setVisualization(workspaceId, tabKey, fetched);
				store.focusEmbeddedPane(workspaceId, hostKey, "visualization");
			})
			.catch(() => {});
		return () => {
			stale = true;
		};
	}, [visualization, workspaceId, tabKey, hostKey]);

	return (
		<div
			data-testid="terminal-instance"
			data-tab-key={tabKey}
			data-ready={ready}
			data-exited={exited}
			data-failed={failed}
			data-detached={detached}
			data-visible="true"
			className="absolute inset-0 z-0"
		>
			<QuietScrollFrame
				viewportSelector=".xterm-scrollable-element"
				surface="terminal"
				edges={scrollEdges}
				className={`absolute inset-12 ${claudeHere ? "bottom-32" : ""}`}
			>
				<div ref={hostRef} className="absolute inset-0" />
			</QuietScrollFrame>
			{claudeHere ? (
				<div
					data-testid="terminal-agent-facts"
					className="absolute inset-x-12 bottom-8 flex items-center gap-4 overflow-hidden"
				>
					{facts.map((fact) =>
						fact.kind === "model" ? (
							// The chip already says which model runs; clicking it changes the answer by driving
							// the session's own /model picker to a session-only pick. See panels/SPEC.md.
							<DropdownMenu key={fact.kind}>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										data-testid="terminal-agent-fact"
										data-kind="model"
										title={`${fact.title} — click to switch`}
										className="flex max-w-[16rem] shrink-0 cursor-pointer items-center gap-2 truncate rounded-[var(--radius-sm)] bg-container-elevated-bg px-4 tr-text-label-pill text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
									>
										<span className="truncate">{fact.label}</span>
										<ChevronDown className="size-12 shrink-0" />
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent data-testid="terminal-model-menu" align="start" side="top">
									{CLAUDE_MODELS.map((model) => (
										<DropdownMenuItem key={model.id} onSelect={() => switchModel(model.id)}>
											{model.label}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						) : fact.kind === "effort" ? (
							// Effort is a slider in the agent's own UI; the chip drives it the same way the model
							// chip drives the model picker, session-only. See panels/SPEC.md.
							<DropdownMenu key={fact.kind}>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										data-testid="terminal-agent-fact"
										data-kind="effort"
										title={`${fact.title} — click to change`}
										className="flex max-w-[16rem] shrink-0 cursor-pointer items-center gap-2 truncate rounded-[var(--radius-sm)] bg-container-elevated-bg px-4 tr-text-label-pill text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
									>
										<span className="truncate">{fact.label}</span>
										<ChevronDown className="size-12 shrink-0" />
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent data-testid="terminal-effort-menu" align="start" side="top">
									{CLAUDE_EFFORT_LEVELS.map((level) => (
										<DropdownMenuItem key={level} onSelect={() => switchEffort(level)}>
											{level}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						) : (
							<span
								key={fact.kind}
								data-testid="terminal-agent-fact"
								data-kind={fact.kind}
								title={fact.title}
								className={`flex max-w-[16rem] shrink-0 items-center gap-4 truncate rounded-[var(--radius-sm)] bg-container-elevated-bg px-4 tr-text-label-pill text-text-muted ${
									fact.kind === "cwd" ? "normal-case" : ""
								}`}
							>
								{fact.kind === "cwd" ? <FolderLine className="size-12 shrink-0" /> : null}
								<span className="truncate">{fact.label}</span>
							</span>
						),
					)}
					{claudeCode?.todos?.length ? <TerminalPlan todos={claudeCode.todos} /> : null}
					<TerminalAttachFile workspaceId={workspaceId} onAttach={attach} />
				</div>
			) : null}
			{detached ? (
				<div
					data-testid="terminal-detached-overlay"
					className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-8 bg-overlay"
				>
					<p className="tr-text-metadata text-text-muted">This terminal is open somewhere else.</p>
					<button
						type="button"
						data-testid="terminal-take-back"
						onClick={takeBack}
						className="rounded-[var(--radius-sm)] bg-control-bg px-8 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
					>
						Take it back
					</button>
				</div>
			) : null}
		</div>
	);
}
