import type { NativeUpdateBridge, NativeUpdateState } from "@thinkrail/contracts";
import Electrobun, { Electroview } from "electrobun/view";
import {
	INITIAL_DESKTOP_PREFERENCES_GLOBAL,
	isDesktopPreferenceKey,
	isDesktopPreferenceValue,
	STABLE_PREFERENCES_GLOBAL,
} from "./preferenceAdapter";
import type { DesktopRpc } from "./rpc";

declare global {
	interface Window {
		__thinkrailDesktop?: boolean;
		__thinkrailToggleWindowZoom?: () => void;
	}
}

interface DesktopPreferenceAdapter {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const updateListeners = new Set<(state: NativeUpdateState) => void>();
const rpc = Electroview.defineRPC<DesktopRpc>({
	maxRequestTime: 5000,
	handlers: {
		requests: {},
		messages: {
			updateStateChanged: (state) => {
				for (const listener of updateListeners) listener(state);
			},
		},
	},
});
const electroview = new Electrobun.Electroview({ rpc });
const globals = globalThis as typeof globalThis & Record<string, unknown>;
const updateBridge: NativeUpdateBridge = Object.freeze({
	getState: () => rpc.request.getUpdateState(),
	checkForUpdates: () => rpc.request.checkForUpdates(),
	restartToUpdate: () => rpc.request.restartToUpdate(),
	subscribe: (listener: (state: NativeUpdateState) => void) => {
		updateListeners.add(listener);
		return () => updateListeners.delete(listener);
	},
});
Object.defineProperty(globals, "__THINKRAIL_NATIVE_UPDATES__", {
	value: updateBridge,
	writable: false,
	configurable: false,
	enumerable: false,
});
const injectedPreferences = Reflect.get(globals, INITIAL_DESKTOP_PREFERENCES_GLOBAL);
const preferences = new Map<string, string>();
if (typeof injectedPreferences === "object" && injectedPreferences !== null) {
	for (const key of Object.keys(injectedPreferences)) {
		const value = Reflect.get(injectedPreferences, key);
		if (isDesktopPreferenceKey(key) && isDesktopPreferenceValue(value)) {
			preferences.set(key, value);
		}
	}
}
Reflect.deleteProperty(globals, INITIAL_DESKTOP_PREFERENCES_GLOBAL);
const preferenceAdapter: DesktopPreferenceAdapter = Object.freeze({
	getItem: (key: string) => (isDesktopPreferenceKey(key) ? (preferences.get(key) ?? null) : null),
	setItem: (key: string, value: string) => {
		if (!isDesktopPreferenceKey(key) || !isDesktopPreferenceValue(value)) return;
		preferences.set(key, value);
		electroview.rpc?.send.preferenceWrite({ key, value });
	},
	removeItem: (key: string) => {
		if (!isDesktopPreferenceKey(key)) return;
		preferences.delete(key);
		electroview.rpc?.send.preferenceRemove({ key });
	},
});
Object.defineProperty(globals, STABLE_PREFERENCES_GLOBAL, {
	value: preferenceAdapter,
	writable: false,
	configurable: false,
	enumerable: false,
});

// The web app depends on contracts alone, so the desktop marks itself with plain globals rather than
// having `apps/web` import anything from here. See apps/web/src/shell/SPEC.md.
window.__thinkrailDesktop = true;
window.__thinkrailToggleWindowZoom = () => electroview.rpc?.send.zoomToggle({});
if (navigator.userAgent.includes("Macintosh")) {
	document.addEventListener("contextmenu", (event) => {
		if (event.defaultPrevented) return;
		event.preventDefault();
		const target = event.target;
		const editable =
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			(target instanceof HTMLElement && target.isContentEditable);
		electroview.rpc?.send.contextMenu({ editable });
	});
}
const sendRoute = () => electroview.rpc?.send.routeChanged({ hash: window.location.hash });
const replaceState = history.replaceState.bind(history);
history.replaceState = (...args: Parameters<History["replaceState"]>) => {
	replaceState(...args);
	sendRoute();
};
const pushState = history.pushState.bind(history);
history.pushState = (...args: Parameters<History["pushState"]>) => {
	pushState(...args);
	sendRoute();
};
window.addEventListener("hashchange", sendRoute);
window.addEventListener("popstate", sendRoute);
window.addEventListener("DOMContentLoaded", sendRoute);
queueMicrotask(sendRoute);
