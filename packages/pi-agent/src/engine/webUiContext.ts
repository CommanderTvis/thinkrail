import { basename, dirname } from "node:path";
import type {
	ExtensionError,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
} from "@earendil-works/pi-coding-agent";
import { plainTextTheme } from "./plainTextTheme";

export type ExtUiNoticeLevel = "info" | "warning" | "error";

export type ExtUiDialog =
	| { kind: "select"; title: string; options: string[] }
	| { kind: "confirm"; title: string; message: string }
	| { kind: "input"; title: string; placeholder?: string }
	| { kind: "editor"; title: string; prefill?: string };

export interface ExtUiBridge {
	ask(
		sessionId: string,
		dialog: ExtUiDialog,
		signal: AbortSignal,
	): Promise<string | boolean | null>;
	notify(sessionId: string, message: string, level: ExtUiNoticeLevel): void;
	setTitle(sessionId: string, title: string): void;
}

const inertBridge: ExtUiBridge = {
	ask: () => Promise.resolve(null),
	notify: () => {},
	setTitle: () => {},
};

let bridge: ExtUiBridge = inertBridge;
export function setExtUiBridge(next: ExtUiBridge): void {
	bridge = next;
}

const open = new Map<string, AbortController>();

export function cancelExtUiForSession(sessionId: string): void {
	open.get(sessionId)?.abort();
	open.delete(sessionId);
}

export function notifyExtUi(sessionId: string, message: string, level: ExtUiNoticeLevel): void {
	bridge.notify(sessionId, message, level);
}

const MAX_EXTENSION_ERROR_CHARS = 500;
const ANONYMOUS_ENTRYPOINTS = new Set(["SKILL.md", "index.ts", "index.js"]);

function extensionName(extensionPath: string): string {
	const file = basename(extensionPath);
	if (!ANONYMOUS_ENTRYPOINTS.has(file)) return file || extensionPath;
	return basename(dirname(extensionPath)) || file;
}

export function notifyExtensionError(sessionId: string, error: ExtensionError): void {
	const cause =
		error.error.length > MAX_EXTENSION_ERROR_CHARS
			? `${error.error.slice(0, MAX_EXTENSION_ERROR_CHARS)}…`
			: error.error;
	notifyExtUi(
		sessionId,
		`Extension ${extensionName(error.extensionPath)} failed on ${error.event}: ${cause}`,
		"error",
	);
}

function sessionAbort(sessionId: string): AbortController {
	const existing = open.get(sessionId);
	if (existing) return existing;
	const created = new AbortController();
	open.set(sessionId, created);
	return created;
}

export function createWebUiContext(sessionId: string): ExtensionUIContext {
	const ask = async (
		dialog: ExtUiDialog,
		opts?: ExtensionUIDialogOptions,
	): Promise<string | boolean | null> => {
		const session = sessionAbort(sessionId);
		const call = new AbortController();
		const cancel = (): void => {
			call.abort();
		};
		session.signal.addEventListener("abort", cancel, { once: true });
		opts?.signal?.addEventListener("abort", cancel, { once: true });
		const timer = typeof opts?.timeout === "number" ? setTimeout(cancel, opts.timeout) : undefined;
		try {
			if (session.signal.aborted || opts?.signal?.aborted) return null;
			return await bridge.ask(sessionId, dialog, call.signal);
		} catch {
			return null;
		} finally {
			if (timer !== undefined) clearTimeout(timer);
			session.signal.removeEventListener("abort", cancel);
			opts?.signal?.removeEventListener("abort", cancel);
		}
	};

	return {
		async select(title, options, opts) {
			const value = await ask({ kind: "select", title, options }, opts);
			return typeof value === "string" ? value : undefined;
		},
		async confirm(title, message, opts) {
			return (await ask({ kind: "confirm", title, message }, opts)) === true;
		},
		async input(title, placeholder, opts) {
			const value = await ask(
				{ kind: "input", title, ...(placeholder ? { placeholder } : {}) },
				opts,
			);
			return typeof value === "string" ? value : undefined;
		},
		async editor(title, prefill) {
			const value = await ask({ kind: "editor", title, ...(prefill ? { prefill } : {}) });
			return typeof value === "string" ? value : undefined;
		},
		notify(message, type) {
			bridge.notify(sessionId, message, type ?? "info");
		},
		setTitle(title) {
			bridge.setTitle(sessionId, title);
		},

		setStatus: () => {},
		setWidget: () => {},
		onTerminalInput: () => () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setFooter: () => {},
		setHeader: () => {},
		custom: (() => Promise.resolve(undefined)) as ExtensionUIContext["custom"],
		pasteToEditor: () => {},
		setEditorText: () => {},
		getEditorText: () => "",
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		theme: plainTextTheme,
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: true }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	} satisfies ExtensionUIContext;
}
