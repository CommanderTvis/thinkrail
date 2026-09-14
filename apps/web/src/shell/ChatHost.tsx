import { lazy } from "react";
import { Companions } from "../panels/Companions";

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
		<Companions host={{ kind: "chat", workspaceId, key: sessionId }}>
			<ChatView sessionId={sessionId} workspaceId={workspaceId} onOpenFile={onOpenFile} />
		</Companions>
	);
}
