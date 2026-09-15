export function cssVar(name: string): string | undefined {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
}

export function editorFontSize(): number {
	return Number.parseFloat(cssVar("--tr-font-size-s11") ?? "") || 11;
}

/**
 * Whether a `ResizeObserver` here accepts `device-pixel-content-box`. Monaco's GPU renderer needs it and
 * throws without it, and WebKit — which the desktop app runs on — does not have it. See SPEC.md.
 */
export function supportsDevicePixelBox(observe: (options: ResizeObserverOptions) => void): boolean {
	try {
		observe({ box: "device-pixel-content-box" });
		return true;
	} catch {
		return false;
	}
}

interface WebGpu {
	requestAdapter(): Promise<unknown>;
}

const devicePixelBoxUsable =
	typeof ResizeObserver !== "undefined" &&
	supportsDevicePixelBox((options) =>
		new ResizeObserver(() => {}).observe(document.createElement("div"), options),
	);

/** Whether Monaco's GPU renderer can run here: a WebGPU adapter and a `device-pixel-content-box`. */
export const editorGpuUsable: Promise<boolean> = (async () => {
	const gpu =
		typeof navigator === "undefined" ? undefined : (navigator as Navigator & { gpu?: WebGpu }).gpu;
	if (!gpu || !devicePixelBoxUsable) return false;
	try {
		return (await gpu.requestAdapter()) !== null;
	} catch {
		return false;
	}
})();
