import { RiFullscreenLine as Maximize2 } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@thinkrail/ui/dialog";
import { onThemeSwap } from "@thinkrail/ui/theme";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { renderMermaid } from "./mermaid";
import { PanZoomView } from "./PanZoomView";

export function MermaidView({
	source,
	title,
	fallback,
	interactive = false,
	onRender,
}: {
	source: string;
	title?: string;
	fallback?: ReactNode;
	/** Fill the space and be navigable in place — a pane, rather than a card in a transcript. */
	interactive?: boolean;
	/** What the renderer made of this source: `null` when it drew, the parse error when it did not. */
	onRender?: (error: string | null) => void;
}) {
	const t = useT();
	const onRenderRef = useRef(onRender);
	onRenderRef.current = onRender;
	const [svg, setSvg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const run = () => {
			renderMermaid(source).then((res) => {
				if (cancelled) return;
				if (res.svg !== undefined) {
					setSvg(res.svg);
					setError(null);
					onRenderRef.current?.(null);
				} else {
					const message = res.error ?? "";
					setError(message);
					onRenderRef.current?.(message);
				}
			});
		};
		setSvg(null);
		setError(null);
		run();
		const stopThemeWatch = onThemeSwap(run);
		return () => {
			cancelled = true;
			stopThemeWatch();
		};
	}, [source]);

	if (error !== null) {
		return (
			<div data-testid="mermaid-error" className="flex flex-col gap-4">
				<span className="text-feedback-error tr-text-metadata">
					{t("visualize.mermaid.renderFailed", {
						error: error || t("visualize.mermaid.renderFailedFallback"),
					})}
				</span>
				<pre className="overflow-auto rounded-sm bg-container-header-bg p-8 tr-code-text text-text-default">
					{source}
				</pre>
			</div>
		);
	}
	if (svg === null) {
		return (
			fallback ?? (
				<span className="text-text-muted tr-text-metadata">{t("visualize.mermaid.rendering")}</span>
			)
		);
	}
	if (interactive) {
		return (
			<div data-testid="mermaid-svg" className="flex h-full min-h-0 flex-col">
				<PanZoomView svg={svg} testid="mermaid-pan-zoom" />
			</div>
		);
	}
	return (
		<div className="relative">
			<PanZoomView svg={svg} testid="mermaid-svg" capped />
			<IconButton
				icon={Maximize2}
				label={t("visualize.mermaid.fullScreenLabel")}
				tooltip={t("visualize.mermaid.fullScreen")}
				variant="outline"
				data-testid="mermaid-fullscreen"
				onClick={() => setOpen(true)}
				className="absolute top-4 right-4"
			/>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent
					data-testid="mermaid-fullscreen-dialog"
					className="flex h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-8"
				>
					<DialogHeader>
						<DialogTitle>{title || t("visualize.mermaid.dialogTitle")}</DialogTitle>
					</DialogHeader>
					<PanZoomView svg={svg} />
				</DialogContent>
			</Dialog>
		</div>
	);
}
