import type { ChatEvent, ChatMessage, Workspace } from "@thinkrail/contracts";
import { getAgentSessions } from "../agent";
import { extractFirstTurn, naiveWorkspaceName } from "../assist";
import { logger } from "../log";
import { getWorkspace, renameWorkspace } from "../workspaces";

const log = logger("host");

const PRISTINE_BRANCH = /^workspace-\d+$/;

export function isPromptCommitted(event: ChatEvent): boolean {
	return event.type === "message_start" && event.message.role === "user";
}

const inFlight = new Set<string>();

export type TranscriptReader = () => Promise<readonly ChatMessage[]>;

export async function maybeNaiveNameWorkspace(
	sessionId: string,
	workspaceId: string,
	readTranscript?: TranscriptReader,
): Promise<Workspace | null> {
	if (inFlight.has(workspaceId)) return null;
	if (!isPristine(workspaceId)) return null;

	inFlight.add(workspaceId);
	try {
		const read =
			readTranscript ??
			(async () => (await getAgentSessions().getMessages(sessionId, workspaceId)).messages);
		const turn = extractFirstTurn(await read());
		if (!turn) return null;
		const name = naiveWorkspaceName(turn.prompt);
		if (!name) return null;

		if (!isPristine(workspaceId)) return null;
		return renameWorkspace(workspaceId, name, { lock: false });
	} catch {
		log.warn(`workspace naive-rename skipped (${workspaceId})`);
		return null;
	} finally {
		inFlight.delete(workspaceId);
	}
}

function isPristine(workspaceId: string): boolean {
	try {
		const ws = getWorkspace(workspaceId);
		return !ws.renamed && PRISTINE_BRANCH.test(ws.branch);
	} catch {
		return false;
	}
}
