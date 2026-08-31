import type {
	HistorySearchResult,
	MessageHit,
	PromptHit,
	TranscriptCorpusSession,
} from "@thinkrail/contracts";
import { MAX_HISTORY_LIMIT, MAX_HISTORY_QUERY_LENGTH } from "@thinkrail/contracts";
import { getTranscriptStore, type TranscriptStore } from "../transcript";

const CORPUS_BUDGET_MS = 150;
const SNIPPET_RADIUS = 60;
const ANCHOR_CHARS = 120;
const DEFAULT_LIMIT = 50;

export interface SearchHistoryInput {
	query: string;
	limit?: number;
	includes: (session: TranscriptCorpusSession) => boolean;
	projectOf: (session: TranscriptCorpusSession) => string | undefined;
}

function clampLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;
	return Math.max(0, Math.min(MAX_HISTORY_LIMIT, Math.floor(limit)));
}

export function matchesTerms(text: string, terms: readonly string[]): boolean {
	const lower = text.toLowerCase();
	return terms.every((term) => lower.includes(term.toLowerCase()));
}

export function makeSnippet(text: string, term: string, radius = SNIPPET_RADIUS): string {
	const idx = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
	if (idx === -1) return text.slice(0, radius * 2);
	const start = Math.max(0, idx - radius);
	const end = Math.min(text.length, idx + term.length + radius);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < text.length ? "…" : "";
	return `${prefix}${text.slice(start, end)}${suffix}`;
}

export async function searchHistory(
	input: SearchHistoryInput,
	store: TranscriptStore = getTranscriptStore(),
): Promise<HistorySearchResult> {
	const corpus = await store.readCorpus(CORPUS_BUDGET_MS);
	const limit = clampLimit(input.limit);
	const query = input.query.slice(0, MAX_HISTORY_QUERY_LENGTH);
	const terms = query.toLowerCase().split(/\s+/);
	const primaryTerm = terms.find((term) => term.length > 0) ?? "";
	const emptyQuery = query.trim().length === 0;

	const prompts: PromptHit[] = [];
	const messages: MessageHit[] = [];

	for (const session of corpus.sessions) {
		if (!input.includes(session)) continue;
		const projectId = input.projectOf(session);
		for (const entry of session.entries) {
			if (!matchesTerms(entry.text, terms)) continue;
			const hit = {
				text: entry.text,
				timestamp: entry.timestamp,
				sessionId: session.sessionId,
				cwd: session.cwd,
				messageId: entry.messageId,
				anchorText: entry.text.slice(0, ANCHOR_CHARS),
				...(session.title ? { sessionTitle: session.title } : {}),
				...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
				...(projectId !== undefined ? { projectId } : {}),
			};
			if (entry.role === "user") {
				prompts.push(hit);
			} else if (!emptyQuery) {
				messages.push({
					...hit,
					role: entry.role,
					snippet: makeSnippet(entry.text, primaryTerm),
				});
			}
		}
	}

	prompts.sort((a, b) => b.timestamp - a.timestamp);
	messages.sort((a, b) => b.timestamp - a.timestamp);

	const seen = new Set<string>();
	const deduped: PromptHit[] = [];
	for (const prompt of prompts) {
		const key = prompt.text.trim().replace(/\s+/g, " ");
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(prompt);
	}

	return {
		prompts: deduped.slice(0, limit),
		messages: messages.slice(0, limit),
		promptTotal: deduped.length,
		messageTotal: messages.length,
		indexing: !corpus.complete,
	};
}
