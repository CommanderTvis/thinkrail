export type DesktopRpc = {
	bun: {
		requests: Record<string, never>;
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
		messages: Record<string, never>;
	};
};
