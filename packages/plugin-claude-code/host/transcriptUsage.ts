import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentTokenUsage } from "../contracts";

interface MessageUsage {
	input_tokens?: unknown;
	output_tokens?: unknown;
	cache_read_input_tokens?: unknown;
	cache_creation_input_tokens?: unknown;
}

interface FileState {
	offset: number;
	byMessage: Map<string, AgentTokenUsage>;
}

const count = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) ? value : 0;

function usageOf(usage: MessageUsage): AgentTokenUsage {
	return {
		input: count(usage.input_tokens),
		output: count(usage.output_tokens),
		cacheRead: count(usage.cache_read_input_tokens),
		cacheWrite: count(usage.cache_creation_input_tokens),
	};
}

function readFrom(path: string, offset: number): Buffer | null {
	try {
		const size = statSync(path).size;
		if (size <= offset) return Buffer.alloc(0);
		const buffer = Buffer.alloc(size - offset);
		const fd = openSync(path, "r");
		try {
			readSync(fd, buffer, 0, buffer.length, offset);
		} finally {
			closeSync(fd);
		}
		return buffer;
	} catch {
		return null;
	}
}

function subagentTranscripts(transcript: string): string[] {
	const dir = join(transcript.replace(/\.jsonl$/, ""), "subagents");
	try {
		return readdirSync(dir)
			.filter((name) => name.endsWith(".jsonl"))
			.map((name) => join(dir, name));
	} catch {
		return [];
	}
}

export interface TranscriptUsage {
	/** The session's spending so far: its own transcript plus every subagent transcript beside it. */
	read(transcript: string): AgentTokenUsage;
	forget(transcript: string): void;
}

export function createTranscriptUsage(): TranscriptUsage {
	const files = new Map<string, FileState>();

	const advance = (path: string): FileState => {
		const state = files.get(path) ?? { offset: 0, byMessage: new Map() };
		files.set(path, state);
		const chunk = readFrom(path, state.offset);
		if (!chunk) return state;
		const complete = chunk.lastIndexOf(0x0a) + 1;
		for (const line of chunk.subarray(0, complete).toString("utf8").split("\n")) {
			if (line === "") continue;
			let entry: { type?: unknown; message?: { id?: unknown; usage?: unknown } };
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			const id = entry?.message?.id;
			const usage = entry?.message?.usage;
			if (entry?.type !== "assistant" || typeof id !== "string") continue;
			if (typeof usage !== "object" || usage === null) continue;
			state.byMessage.set(id, usageOf(usage as MessageUsage));
		}
		state.offset += complete;
		return state;
	};

	return {
		read(transcript) {
			const total: AgentTokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
			for (const path of [transcript, ...subagentTranscripts(transcript)]) {
				for (const usage of advance(path).byMessage.values()) {
					total.input += usage.input;
					total.output += usage.output;
					total.cacheRead += usage.cacheRead;
					total.cacheWrite += usage.cacheWrite;
				}
			}
			return total;
		},
		forget(transcript) {
			for (const path of [...files.keys()]) {
				if (path === transcript || path.startsWith(transcript.replace(/\.jsonl$/, "/"))) {
					files.delete(path);
				}
			}
		},
	};
}
