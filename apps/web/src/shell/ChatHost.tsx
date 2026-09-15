import { lazy } from "react";

const ChatView = lazy(() => import("../chat/ChatView"));

export function ChatHost({
	workspaceId,
	sessionId,
	onOpenFile,
}: {
	workspaceId: string;
	sessionId: string;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	return (
		<div className="relative h-full min-h-0">
			<ChatView sessionId={sessionId} workspaceId={workspaceId} onOpenFile={onOpenFile} />
		</div>
	);
}
