import type {
	TerminalDataPush,
	TerminalDetachedPush,
	TerminalExitPush,
} from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebFontsAddon } from "@xterm/addon-web-fonts";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ITheme, Terminal as XTerm } from "@xterm/xterm";
import {
	type ForwardedRef,
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import "@xterm/xterm/css/xterm.css";
import type { TerminalAccessoryApi } from "@thinkrail/plugin-api/web";
import { Button } from "@thinkrail/plugin-ui";
import { type QuietScrollEdges, QuietScrollFrame } from "@/components/QuietScrollArea";
import { carriesFileDrag, cssColorToHex, draggedFile, shellQuotePath } from "@/lib";
import { tupleKey } from "@/lib/utils";
import { SettingsSection, selectWorkspaceById, useAppStore } from "../store";
import { onThemeSwap } from "../themes";
import { errorText, getTransport } from "../transport";
import { createExtendedKeyState } from "./extendedKeys";
import { createPtySizeSync, runAfterTerminalRelayout } from "./ptySizeSync";
import { stripAnsiDim, terminalContrastFloor } from "./terminalContrast";
import { attachPath } from "./terminalCwd";
import { installTerminalImagePaste } from "./terminalImagePaste";
import { createTerminalPrebindBuffer } from "./terminalPrebindBuffer";

const RESIZE_DEBOUNCE_MS = 60;

const RELAYOUT_TIMEOUT_MS = 4000;

function sendTerminalWrite(send: Promise<unknown>): void {
	void send.catch(() => {});
}

const PICKER_TAIL_LINES = 48;

function terminalTail(term: XTerm, tailLines: number = PICKER_TAIL_LINES): string[] {
	const buffer = term.buffer.active;
	const start = Math.max(0, buffer.length - tailLines);
	const lines: string[] = [];
	for (let i = start; i < buffer.length; i++) {
		lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
	}
	return lines;
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

export type TerminalInstanceHandle = Pick<
	TerminalAccessoryApi,
	"write" | "bufferTail" | "setKeyEncoding"
>;

function TerminalInstance(
	{ tabKey, workspaceId, initialCommand }: Props,
	ref: ForwardedRef<TerminalInstanceHandle>,
) {
	const rootRef = useRef<HTMLDivElement>(null);
	const hostRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<XTerm | null>(null);
	const serverIdRef = useRef<string | null>(null);
	const imagePasteRef = useRef<ReturnType<typeof installTerminalImagePaste> | null>(null);
	const fitFnRef = useRef<(() => void) | null>(null);
	const reattachRef = useRef<(() => void) | null>(null);
	const initialCommandRef = useRef(initialCommand);
	const keyEncodingRef = useRef<"default" | "agent-newline">("default");

	useImperativeHandle(
		ref,
		() => ({
			write(data) {
				imagePasteRef.current?.write(data);
			},
			bufferTail(lines) {
				const term = termRef.current;
				return term ? terminalTail(term, lines) : [];
			},
			setKeyEncoding(mode) {
				keyEncodingRef.current = mode;
			},
		}),
		[],
	);
	const queuedInput = useAppStore(
		(state) => state.terminalInputByWorkspace[tupleKey(workspaceId, tabKey)],
	);

	// ThinkRail speaks to an agent running in this terminal — a spec reconcile, say — and only the
	// component holding the attachment knows the server id to write to. See panels/SPEC.md.
	useEffect(() => {
		const id = serverIdRef.current;
		if (!queuedInput || !id) return;
		const text = useAppStore.getState().consumeTerminalInput(workspaceId, tabKey);
		if (text) imagePasteRef.current?.write(`${text}\r`);
	}, [queuedInput, tabKey, workspaceId]);
	const [pasteError, setPasteError] = useState<string | null>(null);
	const [ready, setReady] = useState(false);
	const [exited, setExited] = useState(false);
	const [failureMessage, setFailureMessage] = useState<string | null>(null);
	const [retrying, setRetrying] = useState(false);
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

		const initialFocusTarget = document.activeElement;
		const focusedTab =
			initialFocusTarget instanceof Element ? initialFocusTarget.closest('[role="tab"]') : null;
		const initialFocusRequestsTerminal = focusedTab?.parentElement?.dataset.kind === "terminal";
		const openLink = (_event: MouseEvent, url: string): void => {
			window.open(url, "_blank", "noopener,noreferrer");
		};
		const term = new XTerm({
			linkHandler: { activate: openLink },
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
		term.loadAddon(new WebLinksAddon(openLink));
		tryLoad(() => {
			term.loadAddon(new Unicode11Addon());
			term.unicode.activeVersion = "11";
		});
		tryLoad(() => term.loadAddon(new ClipboardAddon()));
		const webFonts = new WebFontsAddon(false);
		tryLoad(() => term.loadAddon(webFonts));
		termRef.current = term;
		term.open(host);
		const imagePaste = installTerminalImagePaste(host, {
			id: () => serverIdRef.current,
			bracketed: () => term.modes.bracketedPasteMode,
			save: (id, data, mimeType) =>
				getTransport().request("terminal.saveImage", { id, data, mimeType }),
			write: (id, data) =>
				sendTerminalWrite(getTransport().request("terminal.write", { id, data })),
			error: setPasteError,
		});
		imagePasteRef.current = imagePaste;
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
				const bytes = extendedKeys.encode(event, {
					agentNewline: keyEncodingRef.current === "agent-newline",
				});
				if (bytes !== null) {
					// Returning false tells xterm not to process the key — which also skips the
					// preventDefault it would have done, so the browser was still moving focus on Tab.
					// Anything handled here is handled entirely here.
					event.preventDefault();
					event.stopPropagation();
					imagePaste.write(bytes);
					return false;
				}
			}
			if (event.type !== "keydown" || event.keyCode !== IME_SENTINEL_KEYCODE) return true;
			if (event.isComposing) return true;
			const bytes = imeControlBytes(event);
			if (bytes === null) return true;
			imagePaste.write(bytes);
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
		const onData = term.onData((data) => imagePaste.write(data));

		let attachGeneration = 0;

		const handleExit = (ev: TerminalExitPush): void => {
			if (ev.id !== serverIdRef.current) return;
			imagePaste.cancel();
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
				imagePaste.cancel();
				serverIdRef.current = null;
				attachGeneration += 1;
				setReady(false);
				setRetrying(false);
				setDetached(true);
			},
		);

		let disposed = false;

		const focusIsInTerminal = (): boolean =>
			rootRef.current?.contains(document.activeElement) === true;
		const attach = (restoreFocus = false): void => {
			if (restoreFocus) setRetrying(true);
			else setFailureMessage(null);
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
						const restoreTerminalFocus = restoreFocus
							? focusIsInTerminal()
							: initialFocusRequestsTerminal && document.activeElement === initialFocusTarget;
						setExited(false);
						setReady(true);
						if (restoreTerminalFocus) {
							requestAnimationFrame(() => {
								if (disposed || attachGeneration !== startedAt || prebind !== attemptPrebind) {
									return;
								}
								if (
									(restoreFocus && focusIsInTerminal()) ||
									(!restoreFocus && document.activeElement === initialFocusTarget)
								) {
									term.focus();
								}
								setDetached(false);
								setFailureMessage(null);
								setRetrying(false);
							});
						} else {
							setDetached(false);
							setFailureMessage(null);
							setRetrying(false);
						}
						if (buffered.exit) handleExit(buffered.exit);
						applyFit();
						// Typed, never submitted: the user decides whether to spend a resume — unless the
						// surface that owns this terminal promised to bring its agent back. See SPEC.md.
						if (prefill && serverIdRef.current === id) {
							imagePaste.write(prefillSubmit ? `${prefill}\r` : prefill);
						}
						if (created && serverIdRef.current === id && initialCommandRef.current) {
							imagePaste.write(`${initialCommandRef.current}\r`);
							initialCommandRef.current = undefined;
							useAppStore.getState().consumeTerminalInitialCommand(workspaceId, tabKey);
						}
					};
					if (replay) writeOutput(replay, finishAttach);
					else finishAttach();
				})
				.catch((error) => {
					if (disposed || attachGeneration !== startedAt || prebind !== attemptPrebind) {
						attemptPrebind.stop();
						return;
					}
					attemptPrebind.stop();
					setDetached(false);
					setRetrying(false);
					setFailureMessage(errorText(error, "Couldn’t start or attach the shell."));
				});
		};
		reattachRef.current = () => attach(true);
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
			imagePaste.dispose();
			imagePasteRef.current = null;
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
		});
		return () => cancelAnimationFrame(frame);
	}, []);

	const retry = useCallback(() => reattachRef.current?.(), []);
	const openTerminalSettings = useCallback(
		() => useAppStore.getState().openSettings(SettingsSection.Terminal),
		[],
	);
	const worktreePath = useAppStore(
		(state) => selectWorkspaceById(state, workspaceId)?.worktreePath,
	);
	// Native listeners on purpose: a drop offers no keyboard path to make accessible. See panels/SPEC.md.
	const dropFile = useRef<(file: { path: string }) => void>(() => {});
	dropFile.current = (file) => {
		const id = serverIdRef.current;
		if (!id) return;
		const data = `${shellQuotePath(attachPath(file.path, worktreePath, undefined))} `;
		imagePasteRef.current?.write(data);
	};
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const over = (event: DragEvent) => {
			if (!event.dataTransfer || !carriesFileDrag(event.dataTransfer)) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
		};
		const drop = (event: DragEvent) => {
			const file = event.dataTransfer ? draggedFile(event.dataTransfer) : null;
			if (!file) return;
			event.preventDefault();
			dropFile.current(file);
		};
		host.addEventListener("dragover", over);
		host.addEventListener("drop", drop);
		return () => {
			host.removeEventListener("dragover", over);
			host.removeEventListener("drop", drop);
		};
	}, []);

	return (
		<div
			ref={rootRef}
			data-testid="terminal-instance"
			data-tab-key={tabKey}
			data-ready={ready}
			data-exited={exited}
			data-failed={failureMessage !== null}
			data-detached={detached}
			data-visible="true"
			className="absolute inset-0 z-0 flex flex-col"
		>
			{pasteError ? (
				<div
					role="alert"
					data-testid="terminal-paste-error"
					className="px-12 py-4 tr-text-metadata text-feedback-error"
				>
					{pasteError}
				</div>
			) : null}
			<QuietScrollFrame
				viewportSelector=".xterm-scrollable-element"
				surface="terminal"
				edges={scrollEdges}
				inert={failureMessage !== null && !ready}
				className="mx-12 mt-12 mb-12 min-h-0 flex-1"
			>
				<div ref={hostRef} className="absolute inset-0" />
			</QuietScrollFrame>
			{detached ? (
				<div
					data-testid="terminal-detached-overlay"
					className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-8 bg-overlay"
				>
					<p className="tr-text-metadata text-text-muted">This terminal is open somewhere else.</p>
					<button
						type="button"
						data-testid="terminal-take-back"
						aria-disabled={retrying}
						onClick={retrying ? undefined : retry}
						className="rounded-[var(--radius-sm)] bg-control-bg px-8 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
					>
						{retrying ? "Taking it back…" : "Take it back"}
					</button>
				</div>
			) : null}
			{failureMessage !== null && !detached ? (
				<div
					data-testid="terminal-start-failure"
					className="absolute inset-0 z-30 flex items-center justify-center bg-overlay p-24 text-center"
				>
					<div className="flex flex-col items-center gap-8 rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg p-16 shadow-sm">
						<div role="alert" className="flex flex-col items-center gap-4">
							<p className="tr-title-compact text-text-default">Terminal couldn’t start</p>
							<p className="tr-text-metadata text-text-muted">{failureMessage}</p>
						</div>
						<div className="flex items-center gap-8">
							<Button
								variant="outline"
								size="sm"
								data-testid="terminal-open-settings"
								disabled={retrying}
								onClick={openTerminalSettings}
							>
								Terminal settings
							</Button>
							<Button
								size="sm"
								data-testid="terminal-start-retry"
								aria-disabled={retrying}
								onClick={retrying ? undefined : retry}
							>
								{retrying ? "Retrying…" : "Retry"}
							</Button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}

export default forwardRef(TerminalInstance);
