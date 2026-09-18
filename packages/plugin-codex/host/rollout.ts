import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { CodexPlanItem, CodexTokenUsage } from "../contracts";

export interface RolloutFacts {
	usage?: CodexTokenUsage;
	plan?: CodexPlanItem[];
}

interface FileState extends RolloutFacts {
	offset: number;
}

const PLAN_STATUSES = new Set(["pending", "in_progress", "completed"]);

const count = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) ? value : 0;

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function usageOf(total: Record<string, unknown>): CodexTokenUsage {
	const input = count(total.input_tokens);
	const cached = count(total.cached_input_tokens);
	return {
		input: Math.max(0, input - cached),
		output: count(total.output_tokens),
		cacheRead: cached,
		cacheWrite: count(total.cache_write_input_tokens),
	};
}

function planOf(argumentsJson: unknown): CodexPlanItem[] | null {
	if (typeof argumentsJson !== "string") return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(argumentsJson);
	} catch {
		return null;
	}
	const steps = record(parsed)?.plan;
	if (!Array.isArray(steps)) return null;
	return steps.flatMap((step) => {
		const item = record(step);
		return item && typeof item.step === "string" && PLAN_STATUSES.has(item.status as string)
			? [{ content: item.step, status: item.status as CodexPlanItem["status"] }]
			: [];
	});
}

function apply(state: FileState, line: string): void {
	let entry: Record<string, unknown> | null;
	try {
		entry = record(JSON.parse(line));
	} catch {
		return;
	}
	const payload = record(entry?.payload);
	if (!payload) return;
	if (entry?.type === "event_msg" && payload.type === "token_count") {
		const total = record(record(payload.info)?.total_token_usage);
		if (total) state.usage = usageOf(total);
	} else if (
		entry?.type === "response_item" &&
		payload.type === "function_call" &&
		payload.name === "update_plan"
	) {
		const plan = planOf(payload.arguments);
		if (plan) state.plan = plan;
	}
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

export interface RolloutReader {
	/** The latest token totals and plan Codex itself recorded in this rollout, read forward from last time. */
	read(path: string): RolloutFacts;
	forget(path: string): void;
}

export function createRolloutReader(): RolloutReader {
	const files = new Map<string, FileState>();
	return {
		read(path) {
			const state = files.get(path) ?? { offset: 0 };
			files.set(path, state);
			const chunk = readFrom(path, state.offset);
			if (chunk) {
				const complete = chunk.lastIndexOf(0x0a) + 1;
				for (const line of chunk.subarray(0, complete).toString("utf8").split("\n")) {
					if (line !== "") apply(state, line);
				}
				state.offset += complete;
			}
			return {
				...(state.usage ? { usage: state.usage } : {}),
				...(state.plan ? { plan: state.plan } : {}),
			};
		},
		forget(path) {
			files.delete(path);
		},
	};
}
