import { useEffect, useRef } from "react";
import { hasPlatformModifier, isMacOS } from "../lib";
import { selectHistoryTarget, useAppStore } from "../store";

const TERMINAL_ROOT_SELECTOR = ".xterm";
const MONACO_ROOT_SELECTOR = ".monaco-editor";

type GlobalHotkeyActions = {
	onProjects: () => void;
	onWorkspace?: () => void;
	onBottom?: () => void;
	onFind: () => void;
	onSearch?: () => void;
};

export function isFindChord(event: PanelHotkeyEvent, platform?: string): boolean {
	return (
		event.code === "KeyF" &&
		!event.altKey &&
		!event.shiftKey &&
		hasPlatformModifier(event, platform)
	);
}

export function isSearchChord(event: PanelHotkeyEvent, platform?: string): boolean {
	return (
		event.code === "KeyF" && !event.altKey && event.shiftKey && hasPlatformModifier(event, platform)
	);
}

/** ⌘, is macOS's own Preferences chord, so it exists there and nowhere else — see shell/SPEC.md. */
export function isSettingsChord(event: PanelHotkeyEvent, platform?: string): boolean {
	return (
		event.code === "Comma" &&
		event.metaKey &&
		!event.ctrlKey &&
		!event.altKey &&
		!event.shiftKey &&
		isMacOS(platform)
	);
}

type PanelHotkeyCommand = "projects" | "workspace" | "bottom";

type PanelHotkeyAvailability = Record<PanelHotkeyCommand, boolean>;

type PanelHotkeyEvent = Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey">;

export function panelHotkeyCommand(
	event: PanelHotkeyEvent,
	available: PanelHotkeyAvailability,
	modalOpen: boolean,
	platform?: string,
): PanelHotkeyCommand | null {
	if (modalOpen || event.altKey || !hasPlatformModifier(event, platform)) return null;
	if (!event.shiftKey && event.code === "KeyB" && available.projects) return "projects";
	if (!event.shiftKey && event.code === "KeyJ" && available.workspace) return "workspace";
	if (event.shiftKey && event.code === "KeyJ" && available.bottom) return "bottom";
	return null;
}

function hasOpenModal(): boolean {
	return (
		globalThis.document.querySelector('[aria-modal="true"], [role="dialog"][data-state="open"]') !==
		null
	);
}

function isInTerminal(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(TERMINAL_ROOT_SELECTOR) !== null;
}

function isInMonaco(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(MONACO_ROOT_SELECTOR) !== null;
}

export function useGlobalHotkeys(actions: GlobalHotkeyActions): void {
	const actionsRef = useRef(actions);
	actionsRef.current = actions;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const command = panelHotkeyCommand(
				event,
				{
					projects: true,
					workspace: actionsRef.current.onWorkspace !== undefined,
					bottom: actionsRef.current.onBottom !== undefined,
				},
				hasOpenModal(),
			);
			if (command) {
				event.preventDefault();
				event.stopPropagation();
				if (!event.repeat) {
					if (command === "projects") actionsRef.current.onProjects();
					else if (command === "workspace") actionsRef.current.onWorkspace?.();
					else actionsRef.current.onBottom?.();
				}
				return;
			}

			if (isSettingsChord(event) && !hasOpenModal()) {
				event.preventDefault();
				event.stopPropagation();
				// The pane it last showed, the way a Preferences window comes back where it was left.
				if (!event.repeat) {
					const state = useAppStore.getState();
					state.openSettings(state.settingsSection);
				}
				return;
			}

			if (isSearchChord(event) && actionsRef.current.onSearch && !hasOpenModal()) {
				event.preventDefault();
				event.stopPropagation();
				if (!event.repeat) actionsRef.current.onSearch();
				return;
			}

			if (isFindChord(event) && !hasOpenModal() && !isInMonaco(event.target)) {
				event.preventDefault();
				event.stopPropagation();
				if (!event.repeat) actionsRef.current.onFind();
				return;
			}

			if (
				event.code !== "KeyR" ||
				!event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				event.shiftKey
			) {
				return;
			}
			if (isInTerminal(event.target)) return;
			event.preventDefault();
			event.stopPropagation();
			const target = selectHistoryTarget(useAppStore.getState());
			if (target) useAppStore.getState().requestHistoryOpen(target);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
