let colorCanvas: CanvasRenderingContext2D | null | undefined;

function canvasNormalize(color: string): string {
	if (typeof document === "undefined") return "";
	colorCanvas ??= document.createElement("canvas").getContext("2d");
	if (!colorCanvas) return "";
	colorCanvas.fillStyle = "#000000";
	colorCanvas.fillStyle = color;
	const first = colorCanvas.fillStyle;
	colorCanvas.fillStyle = "#ffffff";
	colorCanvas.fillStyle = color;
	return first === colorCanvas.fillStyle ? first : "";
}

export function cssColorToHex(color: string): string {
	const value = color.trim();
	const short = /^#([0-9a-f]{3,4})$/i.exec(value)?.[1];
	if (short) return `#${[...short].map((c) => c + c).join("")}`;
	if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value;
	const parsed = canvasNormalize(value);
	if (parsed.startsWith("#")) return parsed;
	const [, r, g, b, a] = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(parsed) ?? [];
	const channels = [Number(r), Number(g), Number(b), Math.round(Number(a) * 255)];
	if (channels.some((c) => !Number.isFinite(c))) return "";
	return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
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
