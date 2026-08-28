import type { NativeUpdateState } from "@thinkrail/contracts";

export type DesktopRpc = {
	bun: {
		requests: {
			getUpdateState: { params: undefined; response: NativeUpdateState };
			checkForUpdates: { params: undefined; response: undefined };
			restartToUpdate: { params: undefined; response: undefined };
		};
		messages: {
			routeChanged: { hash: string };
			preferenceWrite: { key: string; value: string };
			preferenceRemove: { key: string };
			/** Our titlebar is the window's; double-clicking it has to reach the window call. */
			zoomToggle: Record<string, never>;
		};
	};
	webview: {
		requests: Record<string, never>;
		messages: {
			updateStateChanged: NativeUpdateState;
		};
	};
};
