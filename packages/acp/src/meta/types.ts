export type ThinkRailExtensionId =
	| "retry"
	| "compaction"
	| "queue"
	| "steering"
	| "skills"
	| "templates"
	| "providerAuth";

export const THINKRAIL_EXTENSION_IDS: readonly ThinkRailExtensionId[] = [
	"retry",
	"compaction",
	"queue",
	"steering",
	"skills",
	"templates",
	"providerAuth",
];

export interface RetryMeta {
	scope: "turn" | "summarization";
	phase: "scheduled" | "cleared";
	attempt: number;
	maxAttempts: number;
	delayMs: number;
	error?: string;
}

export interface CompactionMeta {
	phase: "start" | "end";
	reason: "manual" | "threshold" | "overflow";
	summary?: string;
	tokensBefore?: number;
	supersededMessageId?: string;
	error?: string;
}

export interface QueueMeta {
	steering: number;
	followUp: number;
}

export interface SteerMeta {
	mode: "steer" | "followUp";
}

export interface ThinkRailMeta {
	extensions?: ThinkRailExtensionId[];
	retry?: RetryMeta;
	compaction?: CompactionMeta;
	queue?: QueueMeta;
	steer?: SteerMeta;
}

export const THINKRAIL_EXT_METHODS = {
	skillsList: "dev.thinkrail.v1/skills/list",
	skillsSet: "dev.thinkrail.v1/skills/set",
	sessionReloadResources: "dev.thinkrail.v1/session/reload_resources",
	subagentTranscript: "dev.thinkrail.v1/subagent/transcript",
} as const;

export type ThinkRailExtMethod = (typeof THINKRAIL_EXT_METHODS)[keyof typeof THINKRAIL_EXT_METHODS];
