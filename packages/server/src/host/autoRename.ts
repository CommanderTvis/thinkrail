import type { PiEvent, TranscriptMessage, Workspace } from "@thinkrail/contracts";
import { getSessionMessages, getSessionName, renameSession } from "../agent";
import {
	extractFirstTurn,
	hasEligibleChatTitlePrompt,
	naiveChatTitle,
	naiveWorkspaceName,
	suggestChatTitle,
	suggestWorkspaceName,
	type WorkspaceNameTurn,
} from "../assist";
import { logger } from "../log";
import { getWorkspace, renameWorkspace } from "../workspaces";

const log = logger("host");

const PRISTINE_BRANCH = /^workspace-\d+$/;

export function isSettledTurn(event: PiEvent): boolean {
	return event.type === "agent_settled";
}

export function isPromptCommitted(event: PiEvent): boolean {
	return event.type === "message_end" && event.message.role === "user";
}

const inFlight = new Set<string>();

const naiveInFlight = new Set<string>();

const chatTitleInFlight = new Set<string>();

export type TranscriptReader = () => Promise<TranscriptMessage[]>;

export type ChatTitleWriter = typeof renameSession;
export type ChatTitleReader = (sessionId: string) => string | undefined;

export interface ChatAutoNameOptions {
	priorMessages: readonly TranscriptMessage[];
	writeTitle?: ChatTitleWriter;
	readTitle?: ChatTitleReader;
}

export async function maybeAutoNameChat(
	sessionId: string,
	workspaceId: string,
	firstPrompt: string,
	{ priorMessages, writeTitle = renameSession, readTitle = getSessionName }: ChatAutoNameOptions,
): Promise<boolean> {
	if (readTitle(sessionId) !== undefined || hasEligibleChatTitlePrompt(priorMessages)) return false;
	const fallback = naiveChatTitle(firstPrompt);
	if (!fallback || chatTitleInFlight.has(sessionId)) return false;
	chatTitleInFlight.add(sessionId);
	try {
		const title = (await suggestChatTitle(firstPrompt)) ?? fallback;
		const cwd = getWorkspace(workspaceId).worktreePath;
		return await writeTitle(sessionId, workspaceId, cwd, title, { onlyIfUnnamed: true });
	} catch {
		log.warn(`chat auto-name skipped (${sessionId})`);
		return false;
	} finally {
		chatTitleInFlight.delete(sessionId);
	}
}

function transcriptReader(sessionId: string, workspaceId: string): TranscriptReader {
	return async () =>
		(await getSessionMessages(sessionId, workspaceId, getWorkspace(workspaceId).worktreePath))
			.messages;
}

export function maybeNaiveNameWorkspace(
	sessionId: string,
	workspaceId: string,
	readTranscript: TranscriptReader = transcriptReader(sessionId, workspaceId),
): Promise<Workspace | null> {
	return maybeNaiveNameWorkspaceFrom(
		workspaceId,
		async () => extractFirstTurn(await readTranscript())?.prompt ?? null,
	);
}

export function maybeNaiveNameWorkspaceFromPrompt(
	workspaceId: string,
	prompt: string,
): Promise<Workspace | null> {
	return maybeNaiveNameWorkspaceFrom(workspaceId, async () => prompt);
}

async function maybeNaiveNameWorkspaceFrom(
	workspaceId: string,
	readPrompt: () => Promise<string | null>,
): Promise<Workspace | null> {
	if (naiveInFlight.has(workspaceId)) return null;
	if (!isPristine(workspaceId)) return null;

	naiveInFlight.add(workspaceId);
	try {
		const prompt = await readPrompt();
		if (!prompt) return null;
		const name = naiveWorkspaceName(prompt);
		if (!name) return null;

		if (!isPristine(workspaceId)) return null;
		return renameWorkspace(workspaceId, name, { lock: false });
	} catch {
		log.warn(`workspace naive-rename skipped (${workspaceId})`);
		return null;
	} finally {
		naiveInFlight.delete(workspaceId);
	}
}

function isPristine(workspaceId: string): boolean {
	try {
		const ws = getWorkspace(workspaceId);
		return isAutoNameable(ws) && !ws.renamed && PRISTINE_BRANCH.test(ws.branch);
	} catch {
		return false;
	}
}

function isAutoNameable(ws: Workspace): boolean {
	return ws.kind !== "default" && ws.kind !== "external";
}

export function maybeAutoRenameWorkspace(
	sessionId: string,
	workspaceId: string,
	readTranscript: TranscriptReader = transcriptReader(sessionId, workspaceId),
): Promise<Workspace | null> {
	return maybeAutoRenameWorkspaceFrom(workspaceId, async () =>
		extractFirstTurn(await readTranscript()),
	);
}

export function maybeAutoRenameWorkspaceFromTurn(
	workspaceId: string,
	turn: WorkspaceNameTurn,
): Promise<Workspace | null> {
	return maybeAutoRenameWorkspaceFrom(workspaceId, async () => turn);
}

async function maybeAutoRenameWorkspaceFrom(
	workspaceId: string,
	readTurn: () => Promise<WorkspaceNameTurn | null>,
): Promise<Workspace | null> {
	if (inFlight.has(workspaceId)) return null;
	let ws: Workspace;
	try {
		ws = getWorkspace(workspaceId);
	} catch {
		return null;
	}
	if (ws.renamed || !isAutoNameable(ws)) return null;

	inFlight.add(workspaceId);
	try {
		const turn = await readTurn();
		if (!turn) return null;
		const name = await suggestWorkspaceName(turn);
		if (!name) return null;

		const fresh = getWorkspace(workspaceId);
		if (fresh.renamed) return null;
		return renameWorkspace(workspaceId, name);
	} catch {
		log.warn(`workspace auto-rename skipped (${workspaceId})`);
		return null;
	} finally {
		inFlight.delete(workspaceId);
	}
}
