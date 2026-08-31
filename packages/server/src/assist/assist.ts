import type { AssistantMessage, ChatMessage, StopReason, UserMessage } from "@thinkrail/contracts";

export interface WorkspaceNameTurn {
	prompt: string;
	answer: string;
}

const MAX_NAME_LENGTH = 60;

const MAX_NAME_WORDS = 5;

const NAIVE_MIN_WORDS = 2;
const NAIVE_MAX_WORDS = 5;
const NAIVE_MIN_CHARS = 10;
const NAIVE_MAX_CHARS = 40;

const KILLED_STOP_REASONS: readonly StopReason[] = ["failed", "cancelled", "refused"];

export function naiveWorkspaceName(prompt: string): string | null {
	const words = prompt
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (words.length === 0) return null;

	const picked: string[] = [];
	let length = 0;
	for (const word of words) {
		const next = length === 0 ? word.length : length + 1 + word.length;
		const haveMinimum = picked.length >= NAIVE_MIN_WORDS && length >= NAIVE_MIN_CHARS;
		if (picked.length >= NAIVE_MAX_WORDS) break;
		if (next > NAIVE_MAX_CHARS && haveMinimum) break;
		picked.push(word);
		length = next;
	}

	const name = picked.map(titleCaseWord).join(" ").slice(0, NAIVE_MAX_CHARS).trimEnd();
	return name.length > 0 ? name : null;
}

function titleCaseWord(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

export function toWorkspaceName(raw: string): string | null {
	const name = raw
		.trim()
		.replace(/^[`'"]+|[`'"]+$/g, "")
		.replace(/[^A-Za-z0-9]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, MAX_NAME_WORDS)
		.join(" ")
		.slice(0, MAX_NAME_LENGTH)
		.trimEnd();
	return name.length > 0 ? name : null;
}

export function extractFirstTurn(messages: readonly ChatMessage[]): WorkspaceNameTurn | null {
	for (let i = 0; i < messages.length; i += 1) {
		const message = messages[i];
		if (message?.role !== "user" || message.hidden === true) continue;
		let answer: string | undefined;
		let killed = false;
		let j = i + 1;
		for (; j < messages.length && !isVisibleUser(messages[j]); j += 1) {
			const next = messages[j];
			if (next?.role === "assistant") answer ??= assistantText(next);
			if (next?.role === "marker" && next.marker.kind === "turnSettled") {
				killed = KILLED_STOP_REASONS.includes(next.marker.stopReason);
			}
		}
		const prompt = userText(message);
		if (killed || !prompt.trim()) {
			i = j - 1;
			continue;
		}
		return { prompt, answer: answer ?? "" };
	}
	return null;
}

function isVisibleUser(message: ChatMessage | undefined): boolean {
	return message?.role === "user" && message.hidden !== true;
}

function userText(message: UserMessage): string {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function assistantText(message: AssistantMessage): string {
	return message.blocks
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}
