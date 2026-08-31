import type { ChatMessage, MessageId, SessionRecord } from "@thinkrail/contracts";
import { transcriptPaths, transcriptsRootIn } from "./paths";
import { TranscriptStore } from "./store";

const FIXTURE_AGENT_ID = "fixture";

export interface FixtureMessage {
	role: "user" | "assistant";
	text: string;
	timestamp: number;
	id?: MessageId;
}

export interface FixtureTranscript {
	sessionId?: string;
	workspaceId: string;
	cwd: string;
	agentId?: string;
	title?: string;
	messages: readonly FixtureMessage[];
}

export interface FixtureTranscriptResult {
	sessionId: string;
	dir: string;
	record: SessionRecord;
}

export function openFixtureStore(dataDir: string): TranscriptStore {
	return new TranscriptStore(transcriptsRootIn(dataDir));
}

export async function writeFixtureTranscript(
	dataDir: string,
	input: FixtureTranscript,
): Promise<FixtureTranscriptResult> {
	const sessionId = input.sessionId ?? `fixture-${crypto.randomUUID()}`;
	const store = openFixtureStore(dataDir);
	let record = await store.open({
		sessionId,
		workspaceId: input.workspaceId,
		cwd: input.cwd,
		agentId: input.agentId ?? FIXTURE_AGENT_ID,
	});

	const last = input.messages.at(-1);
	if (input.title !== undefined) {
		record = store.append(sessionId, {
			type: "session_info",
			title: input.title,
			...(last !== undefined ? { updatedAt: last.timestamp } : {}),
		}).record;
	}
	input.messages.forEach((message, index) => {
		record = store.append(sessionId, {
			type: "message_start",
			message: seedMessage(sessionId, message, index),
		}).record;
	});
	if (last !== undefined) {
		record = store.append(sessionId, {
			type: "turn_settled",
			message: {
				role: "marker",
				id: `${sessionId}-settled`,
				timestamp: last.timestamp,
				marker: { kind: "turnSettled", stopReason: "completed" },
			},
		}).record;
	}

	await store.close(sessionId);
	return { sessionId, dir: transcriptPaths(transcriptsRootIn(dataDir), sessionId).dir, record };
}

function seedMessage(sessionId: string, message: FixtureMessage, index: number): ChatMessage {
	const id = message.id ?? `${sessionId}-m${index}`;
	if (message.role === "user") {
		return {
			role: "user",
			id,
			timestamp: message.timestamp,
			content: [{ type: "text", text: message.text }],
		};
	}
	return {
		role: "assistant",
		id,
		timestamp: message.timestamp,
		endedAt: message.timestamp,
		blocks: [{ type: "text", text: message.text }],
	};
}
