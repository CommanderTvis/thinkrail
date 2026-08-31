import type {
	CompactionMeta,
	QueueMeta,
	RetryMeta,
	SteerMeta,
	ThinkRailExtensionId,
	ThinkRailMeta,
} from "./types";
import { THINKRAIL_EXTENSION_IDS } from "./types";

export const THINKRAIL_META_KEY = "dev.thinkrail.v1";

export type MetaBag = { readonly [key: string]: unknown } | null | undefined;

function record(value: unknown): { [key: string]: unknown } | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	return value as { [key: string]: unknown };
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
	return typeof value === "string" && (allowed as readonly string[]).includes(value)
		? (value as T)
		: undefined;
}

function readExtensions(value: unknown): ThinkRailExtensionId[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const ids: ThinkRailExtensionId[] = [];
	for (const entry of value) {
		const id = oneOf(entry, THINKRAIL_EXTENSION_IDS);
		if (id !== undefined && !ids.includes(id)) ids.push(id);
	}
	return ids;
}

function readRetry(value: unknown): RetryMeta | undefined {
	const raw = record(value);
	if (raw === undefined) return undefined;
	const scope = oneOf(raw.scope, ["turn", "summarization"] as const);
	const phase = oneOf(raw.phase, ["scheduled", "cleared"] as const);
	if (scope === undefined || phase === undefined) return undefined;
	const error = str(raw.error);
	return {
		scope,
		phase,
		attempt: num(raw.attempt) ?? 0,
		maxAttempts: num(raw.maxAttempts) ?? 0,
		delayMs: num(raw.delayMs) ?? 0,
		...(error !== undefined ? { error } : {}),
	};
}

function readCompaction(value: unknown): CompactionMeta | undefined {
	const raw = record(value);
	if (raw === undefined) return undefined;
	const phase = oneOf(raw.phase, ["start", "end"] as const);
	const reason = oneOf(raw.reason, ["manual", "threshold", "overflow"] as const);
	if (phase === undefined || reason === undefined) return undefined;
	const summary = str(raw.summary);
	const tokensBefore = num(raw.tokensBefore);
	const supersededMessageId = str(raw.supersededMessageId);
	const error = str(raw.error);
	return {
		phase,
		reason,
		...(summary !== undefined ? { summary } : {}),
		...(tokensBefore !== undefined ? { tokensBefore } : {}),
		...(supersededMessageId !== undefined ? { supersededMessageId } : {}),
		...(error !== undefined ? { error } : {}),
	};
}

function readQueue(value: unknown): QueueMeta | undefined {
	const raw = record(value);
	if (raw === undefined) return undefined;
	const steering = num(raw.steering);
	const followUp = num(raw.followUp);
	if (steering === undefined || followUp === undefined) return undefined;
	return { steering, followUp };
}

function readSteer(value: unknown): SteerMeta | undefined {
	const raw = record(value);
	if (raw === undefined) return undefined;
	const mode = oneOf(raw.mode, ["steer", "followUp"] as const);
	return mode === undefined ? undefined : { mode };
}

export function readThinkRailMeta(meta: MetaBag): ThinkRailMeta | undefined {
	const bag = record(meta);
	if (bag === undefined) return undefined;
	const raw = record(bag[THINKRAIL_META_KEY]);
	if (raw === undefined) return undefined;

	const extensions = readExtensions(raw.extensions);
	const retry = readRetry(raw.retry);
	const compaction = readCompaction(raw.compaction);
	const queue = readQueue(raw.queue);
	const steer = readSteer(raw.steer);

	const payload: ThinkRailMeta = {
		...(extensions !== undefined ? { extensions } : {}),
		...(retry !== undefined ? { retry } : {}),
		...(compaction !== undefined ? { compaction } : {}),
		...(queue !== undefined ? { queue } : {}),
		...(steer !== undefined ? { steer } : {}),
	};
	return Object.keys(payload).length > 0 ? payload : undefined;
}

export function writeThinkRailMeta(payload: ThinkRailMeta): { [key: string]: unknown } {
	return { [THINKRAIL_META_KEY]: payload };
}

export function mergeThinkRailMeta(
	meta: MetaBag,
	payload: ThinkRailMeta,
): { [key: string]: unknown } {
	return { ...(record(meta) ?? {}), [THINKRAIL_META_KEY]: payload };
}
