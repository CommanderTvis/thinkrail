import {
	RiSubtractLine as Minus,
	RiAddLine as Plus,
	RiRefreshLine as Refresh,
	RiAnticlockwiseLine as RotateCcw,
} from "@remixicon/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { clampZoomScale, isZoomGesture, ZOOM_SCALE_STEP, zoomScaleForWheel } from "@/lib";
import { IconTooltip } from "../components/ui/tooltip";
import { worktreeFileUrl } from "./filesUrl";

/**
 * An image tab renders its bytes over the `/files/…` route, exactly as a PDF does — the tab's text
 * content is never the picture. `cacheBust` reloads it when an agent rewrites the file; the toolbar's
 * reload asks again for bytes no watch reported. Zoom multiplies a measured fit width (100% = natural
 * size, capped to the pane), driven by the same pinch/wheel gesture and buttons as the PDF viewer.
 * See SPEC.md.
 */
export function ImagePreview({
	workspaceId,
	path,
	cacheBust,
}: {
	workspaceId: string;
	path: string;
	cacheBust: number;
}) {
	const [size, setSize] = useState<{ width: number; height: number } | null>(null);
	// Measured once per load: the width the picture gets at 100%, natural size capped to the pane.
	const [fitWidth, setFitWidth] = useState<number | null>(null);
	const [scale, setScale] = useState(1);
	const [reloads, setReloads] = useState(0);
	const scrollRef = useRef<HTMLDivElement>(null);

	const zoomBy = useCallback((factor: number) => {
		setScale((current) => clampZoomScale(current * factor));
	}, []);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		// macOS pinch arrives as a wheel event with ctrlKey set; ⌘/Ctrl+wheel is the same gesture by hand.
		const onWheel = (event: WheelEvent) => {
			if (!isZoomGesture(event)) return;
			event.preventDefault();
			setScale((current) => zoomScaleForWheel(current, event.deltaY, event.deltaMode));
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="image-toolbar"
				role="toolbar"
				aria-label="Image view"
				className="flex h-32 shrink-0 items-center justify-end gap-4 border-border-default border-b bg-container-header-bg px-8"
			>
				<span
					data-testid="image-preview-size"
					className="mr-auto tr-text-metadata text-text-subtle tabular-nums"
				>
					{size ? `${size.width} × ${size.height}` : ""}
				</span>
				<span
					data-testid="image-zoom-level"
					className="tr-text-metadata text-text-muted tabular-nums"
				>
					{Math.round(scale * 100)}%
				</span>
				<IconTooltip label="Reload from disk">
					<button
						type="button"
						data-testid="image-reload"
						aria-label="Reload from disk"
						onClick={() => setReloads((count) => count + 1)}
						className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<Refresh className="size-14" />
					</button>
				</IconTooltip>
				<IconTooltip label="Zoom out">
					<button
						type="button"
						data-testid="image-zoom-out"
						aria-label="Zoom out"
						onClick={() => zoomBy(1 / ZOOM_SCALE_STEP)}
						className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<Minus className="size-14" />
					</button>
				</IconTooltip>
				<IconTooltip label="Zoom in">
					<button
						type="button"
						data-testid="image-zoom-in"
						aria-label="Zoom in"
						onClick={() => zoomBy(ZOOM_SCALE_STEP)}
						className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<Plus className="size-14" />
					</button>
				</IconTooltip>
				<IconTooltip label="Reset zoom">
					<button
						type="button"
						data-testid="image-zoom-reset"
						aria-label="Reset zoom"
						onClick={() => setScale(1)}
						className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<RotateCcw className="size-14" />
					</button>
				</IconTooltip>
			</div>
			<div
				ref={scrollRef}
				data-testid="image-preview"
				className="min-h-0 flex-1 overflow-auto bg-container-workspace-bg p-16"
			>
				<img
					data-testid="image-preview-img"
					src={`${worktreeFileUrl(workspaceId, path)}?t=${cacheBust}.${reloads}`}
					alt={path.split("/").at(-1) ?? path}
					style={fitWidth === null ? undefined : { width: `${Math.round(fitWidth * scale)}px` }}
					onLoad={(event) => {
						const img = event.currentTarget;
						setSize({ width: img.naturalWidth, height: img.naturalHeight });
						const pane = scrollRef.current;
						setFitWidth(
							Math.max(1, Math.min(img.naturalWidth, (pane?.clientWidth ?? img.naturalWidth) - 32)),
						);
					}}
					className={`mx-auto rounded-[var(--radius-sm)] ${fitWidth === null ? "max-w-full" : "max-w-none"}`}
				/>
			</div>
		</div>
	);
}
