import { readFileSync } from "node:fs";
import type { ClaudeAccount, ClaudeUsageSeverity, ClaudeUsageWindow } from "@thinkrail/contracts";
import { runBounded } from "../subprocess";
import { claudeStatePath } from "./paths";
import { claudeBinary } from "./uninstall";

const TIMEOUT_MS = 20_000;

/** The fallback for a cache written before Claude Code described its own limits — see SPEC.md. */
const NAMED_WINDOWS: readonly [string, string][] = [
	["five_hour", "Session (5 hr)"],
	["seven_day", "Weekly (7 day)"],
];

const KIND_LABELS: Record<string, string> = {
	session: "Session (5 hr)",
	weekly_all: "Weekly (7 day)",
};

function severityOf(value: unknown): ClaudeUsageSeverity {
	return value === "critical" || value === "warning" ? value : "normal";
}

function modelName(scope: unknown): string | undefined {
	if (!isRecord(scope) || !isRecord(scope.model)) return undefined;
	return text(scope.model.display_name);
}

/**
 * Claude Code caches a self-describing list beside its per-key buckets: every entry carries its kind,
 * its severity, and — for a model-scoped week — the model's own display name. Reading that list is what
 * lets a limit be labelled with the model it belongs to instead of the rotating code name the buckets
 * are keyed by. See SPEC.md.
 */
function windowsFromLimits(value: unknown): ClaudeUsageWindow[] {
	if (!Array.isArray(value)) return [];
	const windows: ClaudeUsageWindow[] = [];
	for (const [index, entry] of value.entries()) {
		if (!isRecord(entry) || typeof entry.percent !== "number") continue;
		const kind = text(entry.kind) ?? "limit";
		const model = modelName(entry.scope);
		const label = model ? `${model} limit` : (KIND_LABELS[kind] ?? null);
		if (label === null) continue;
		const resetsAt = text(entry.resets_at);
		windows.push({
			id: model ? `${kind}:${model}` : `${kind}:${index}`,
			label,
			percent: Math.max(0, Math.min(100, Math.round(entry.percent))),
			severity: severityOf(entry.severity),
			...(resetsAt ? { resetsAt } : {}),
		});
	}
	return windows;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readUsage(): { usage: ClaudeUsageWindow[]; fetchedAt?: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(claudeStatePath(), "utf8"));
	} catch {
		return { usage: [] };
	}
	if (!isRecord(parsed)) return { usage: [] };
	const cached = parsed.cachedUsageUtilization;
	if (!isRecord(cached)) return { usage: [] };
	const utilization = isRecord(cached.utilization) ? cached.utilization : {};
	const described = windowsFromLimits(utilization.limits);
	const usage: ClaudeUsageWindow[] = [...described];
	for (const [id, label] of described.length > 0 ? [] : NAMED_WINDOWS) {
		const window = utilization[id];
		if (!isRecord(window) || typeof window.utilization !== "number") continue;
		const resetsAt = text(window.resets_at);
		usage.push({
			id,
			label,
			percent: Math.max(0, Math.min(100, Math.round(window.utilization))),
			severity: "normal",
			...(resetsAt ? { resetsAt } : {}),
		});
	}
	const fetchedAtMs = cached.fetchedAtMs;
	return {
		usage,
		...(typeof fetchedAtMs === "number" && Number.isFinite(fetchedAtMs)
			? { fetchedAt: new Date(fetchedAtMs).toISOString() }
			: {}),
	};
}

export async function readClaudeAccount(claudeCommand: string): Promise<ClaudeAccount> {
	const { usage, fetchedAt } = readUsage();
	const base: ClaudeAccount = {
		loggedIn: false,
		usage,
		...(fetchedAt ? { usageFetchedAt: fetchedAt } : {}),
	};

	const run = await runBounded([claudeBinary(claudeCommand), "auth", "status", "--json"], {
		timeoutMs: TIMEOUT_MS,
		env: process.env,
	});
	if (!run.ok) return base;
	let status: unknown;
	try {
		status = JSON.parse(run.out);
	} catch {
		return base;
	}
	if (!isRecord(status)) return base;
	return {
		...base,
		loggedIn: status.loggedIn === true,
		...(text(status.email) ? { email: text(status.email) as string } : {}),
		...(text(status.orgName) ? { organization: text(status.orgName) as string } : {}),
		...(text(status.subscriptionType)
			? { subscription: text(status.subscriptionType) as string }
			: {}),
		...(text(status.authMethod) ? { authMethod: text(status.authMethod) as string } : {}),
	};
}
