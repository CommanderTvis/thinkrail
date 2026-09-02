import { RiCloseLine } from "@remixicon/react";
import { type ReactNode, useEffect, useRef } from "react";
import {
	type ImperativePanelHandle,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "./ui/resizable";

const COMPANION_SIZE = 45;
const COMPANION_MIN = 15;

export interface EmbeddedCompanion {
	title: string;
	content: ReactNode;
	onClose?: () => void;
	testid?: string;
}

/**
 * A companion view living inside the tab that owns it — a column beside or a row under the host's own
 * body, never an independent tab. See shell/layout/SPEC.md (Embedded panes).
 */
export function EmbeddedSplit({
	direction,
	companion,
	children,
}: {
	direction: "horizontal" | "vertical";
	companion: EmbeddedCompanion | null;
	children: ReactNode;
}) {
	// The group and both panels always render, and both carry a stable `id`: a companion appearing must
	// not re-key the host panel, because remounting an imperatively-attached body (xterm) would kill the
	// PTY it is attached to. The handle is the one thing unmounted — hidden, it still hit-tests at (0,0).
	const testid = companion?.testid ?? "embedded-pane";
	const open = companion !== null;
	const companionPanel = useRef<ImperativePanelHandle>(null);
	// `defaultSize` only counts at mount, and the group mounts with the companion at 0: opening later
	// would leave it at its minimum, a sliver. See shell/layout/SPEC.md (Embedded panes).
	useEffect(() => {
		const panel = companionPanel.current;
		if (!panel) return;
		if (open && panel.getSize() < COMPANION_SIZE) panel.resize(COMPANION_SIZE);
		if (!open && panel.getSize() > 0) panel.resize(0);
	}, [open]);
	return (
		<ResizablePanelGroup direction={direction} className="h-full min-h-0 w-full">
			<ResizablePanel id="embedded-host" order={1} defaultSize={100 - COMPANION_SIZE} minSize={20}>
				{children}
			</ResizablePanel>
			{open ? <ResizableHandle /> : null}
			<ResizablePanel
				ref={companionPanel}
				id="embedded-companion"
				order={2}
				defaultSize={open ? COMPANION_SIZE : 0}
				minSize={open ? COMPANION_MIN : 0}
				className={open ? "" : "hidden"}
			>
				{companion === null ? null : (
					<div data-testid={testid} className="flex h-full min-h-0 flex-col">
						<div className="flex h-28 shrink-0 items-center justify-between border-border-default border-b bg-container-header-bg pr-4 pl-8">
							<span
								data-testid="embedded-pane-title"
								className="truncate tr-text-metadata text-text-muted"
							>
								{companion.title}
							</span>
							{companion.onClose ? (
								<button
									type="button"
									data-testid="embedded-pane-close"
									aria-label={`Close ${companion.title}`}
									onClick={companion.onClose}
									className="rounded-[var(--radius-sm)] p-2 text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
								>
									<RiCloseLine className="size-14" />
								</button>
							) : null}
						</div>
						<div className="min-h-0 flex-1 overflow-hidden">{companion.content}</div>
					</div>
				)}
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
