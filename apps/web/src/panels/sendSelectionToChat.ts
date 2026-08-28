import { type EditorSelection, selectionQuote } from "../lib";
import {
	layoutOpenOptionsForNavigation,
	selectLastOpenChatSession,
	toast,
	useAppStore,
} from "../store";
import { createSessionWithSkillBaseline, errorText } from "../transport";
import { openChatInTab } from "./openChat";

async function chatForSelection(workspaceId: string): Promise<string> {
	const navigation = useAppStore.getState().beginCenterNavigation(workspaceId);
	const open = selectLastOpenChatSession(useAppStore.getState(), workspaceId);
	if (open) {
		await openChatInTab(workspaceId, open, navigation, { focusTab: false });
		return open;
	}
	const { result, syncedTick } = await createSessionWithSkillBaseline({ workspaceId });
	const store = useAppStore.getState();
	store.openChatSession(
		workspaceId,
		result.sessionId,
		result.model,
		result.thinkingLevel,
		syncedTick,
		{ ...layoutOpenOptionsForNavigation(store, workspaceId, navigation), focusTab: false },
	);
	return result.sessionId;
}

export async function sendSelectionToChat(
	selection: EditorSelection & { workspaceId: string },
): Promise<void> {
	if (!selection.text.trim()) return;
	try {
		const sessionId = await chatForSelection(selection.workspaceId);
		useAppStore.getState().addToChatDraft(sessionId, selectionQuote(selection));
	} catch (err) {
		toast.error(errorText(err), "Couldn't send the selection to a chat");
	}
}
