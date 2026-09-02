import { RiBookOpenLine as BlueprintIcon } from "@remixicon/react";
import { lazy, Suspense } from "react";
import { EmbeddedSplit } from "@/components/EmbeddedSplit";
import { embeddedHostKey, useAppStore } from "../store";

const ChatView = lazy(() => import("../chat/ChatView"));
const BlueprintPane = lazy(() =>
	import("../panels/BlueprintView").then((module) => ({ default: module.BlueprintPane })),
);

/**
 * A chat with company: the blueprint it authors lives in an embedded pane beside the transcript.
 * Composed here because chat may not import panels — see chat/SPEC.md.
 *
 * A *visualization* is deliberately not offered here: the transcript already renders the `visualize`
 * call where it happened, and a pane repeating it beside its own card is the same picture twice. A
 * terminal has no transcript to render into, which is why it gets one and a chat does not.
 */
export function ChatHost({
	workspaceId,
	sessionId,
	onOpenFile,
}: {
	workspaceId: string;
	sessionId: string;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	const paneDirection = useAppStore((s) => s.localLayoutPreferences.defaultPaneDirection);
	const hostKey = embeddedHostKey("chat", sessionId);
	const hidden = useAppStore(
		(s) => s.embeddedPanes[workspaceId]?.[hostKey]?.hidden?.blueprint === true,
	);
	const blueprint = useAppStore((s) => s.blueprintByWorkspace[workspaceId]);
	const authorsBlueprint =
		blueprint?.author?.kind === "chat" && blueprint.author.sessionId === sessionId;

	const companion =
		authorsBlueprint && !hidden
			? {
					title: "Blueprint",
					content: (
						<Suspense fallback={null}>
							<BlueprintPane workspaceId={workspaceId} />
						</Suspense>
					),
					onClose: () =>
						useAppStore.getState().setEmbeddedPaneHidden(workspaceId, hostKey, "blueprint", true),
				}
			: null;

	return (
		<EmbeddedSplit direction={paneDirection} companion={companion}>
			<div className="relative h-full min-h-0">
				<ChatView sessionId={sessionId} workspaceId={workspaceId} onOpenFile={onOpenFile} />
				{authorsBlueprint && hidden ? (
					<button
						type="button"
						data-testid="chat-embedded-chip"
						data-kind="blueprint"
						title="Show the blueprint"
						onClick={() =>
							useAppStore.getState().focusEmbeddedPane(workspaceId, hostKey, "blueprint")
						}
						className="absolute top-44 right-12 z-20 flex shrink-0 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] bg-container-elevated-bg px-4 tr-text-label-pill text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<BlueprintIcon className="size-12 shrink-0" />
						<span>Blueprint</span>
					</button>
				) : null}
			</div>
		</EmbeddedSplit>
	);
}
