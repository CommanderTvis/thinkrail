import {
	RiSubtractLine as Minus,
	RiAddLine as Plus,
	RiArrowGoBackLine as RotateCcw,
} from "@remixicon/react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { clampZoomScale, isZoomGesture, ZOOM_SCALE_STEP, zoomScaleForWheel } from "@/lib";

/**
 * A diagram you can get around in: ⌘/Ctrl+wheel and trackpad pinch zoom, drag pans, plain wheel scrolls.
 * The same gesture vocabulary the PDF preview uses, from the same shared module. See chat/SPEC.md.
 */
export function PanZoomView({ svg, testid }: { svg: string; testid?: string }) {
	const [scale, setScale] = useState(1);
	const scrollRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		// macOS delivers a trackpad pinch as a wheel event with ctrlKey set; non-passive so the browser's
		// own page zoom gives way to the diagram's.
		const onWheel = (event: WheelEvent) => {
			if (!isZoomGesture(event)) return;
			event.preventDefault();
			setScale((current) => zoomScaleForWheel(current, event.deltaY, event.deltaMode));
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		if (e.pointerType !== "mouse") return;
		const el = scrollRef.current;
		if (!el) return;
		drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
		el.setPointerCapture(e.pointerId);
	};
	const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		const el = scrollRef.current;
		const start = drag.current;
		if (!el || !start) return;
		el.scrollLeft = start.left - (e.clientX - start.x);
		el.scrollTop = start.top - (e.clientY - start.y);
	};
	const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
		const el = scrollRef.current;
		if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
		drag.current = null;
	};

	const reset = () => {
		setScale(1);
		if (scrollRef.current) {
			scrollRef.current.scrollLeft = 0;
			scrollRef.current.scrollTop = 0;
		}
	};

	const btn =
		"rounded-[var(--radius-sm)] p-4 text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary";

	return (
		<div className="relative min-h-0 flex-1">
			<div
				ref={scrollRef}
				data-testid={testid ?? "mermaid-fullscreen-svg"}
				className="h-full w-full cursor-grab select-none overflow-auto active:cursor-grabbing [&_svg]:!h-auto [&_svg]:!w-[var(--zoom)] [&_svg]:!max-w-none"
				style={{ "--zoom": `${scale * 100}%` } as React.CSSProperties}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				// biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid renders agent-provided source with securityLevel "strict"
				dangerouslySetInnerHTML={{ __html: svg }}
			/>
			<div className="absolute right-8 bottom-8 flex items-center gap-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg p-4 tr-text-metadata shadow-[var(--shadow-lg)]">
				<button
					type="button"
					aria-label="Zoom out"
					data-testid="mermaid-zoom-out"
					onClick={() => setScale((s) => clampZoomScale(s / ZOOM_SCALE_STEP))}
					className={btn}
				>
					<Minus className="size-16" />
				</button>
				<span
					data-testid="mermaid-zoom-level"
					className="min-w-[3.5ch] text-center text-text-muted tabular-nums"
				>
					{Math.round(scale * 100)}%
				</span>
				<button
					type="button"
					aria-label="Zoom in"
					data-testid="mermaid-zoom-in"
					onClick={() => setScale((s) => clampZoomScale(s * ZOOM_SCALE_STEP))}
					className={btn}
				>
					<Plus className="size-16" />
				</button>
				<button
					type="button"
					aria-label="Reset zoom"
					data-testid="mermaid-zoom-reset"
					onClick={reset}
					className={btn}
				>
					<RotateCcw className="size-14" />
				</button>
			</div>
		</div>
	);
}
