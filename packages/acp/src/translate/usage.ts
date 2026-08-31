import type { UsageUpdate } from "@agentclientprotocol/sdk";
import type { Money, SessionUsage, TokenUsage } from "@thinkrail/contracts";
import { asNumber, asRecord, asString } from "./guards";

export function usageFromUpdate(update: UsageUpdate, tokens?: TokenUsage): SessionUsage {
	const cost = toMoney(update.cost);
	return {
		contextUsed: asNumber(update.used) ?? null,
		contextWindow: asNumber(update.size) ?? null,
		...(tokens !== undefined ? { tokens } : {}),
		...(cost !== undefined ? { cost } : {}),
	};
}

export function toMoney(cost: unknown): Money | undefined {
	const raw = asRecord(cost);
	if (raw === undefined) return undefined;
	const amount = asNumber(raw.amount);
	if (amount === undefined) return undefined;
	return { amount, currency: asString(raw.currency) ?? "USD" };
}

export function toTokenUsage(usage: unknown): TokenUsage | undefined {
	const raw = asRecord(usage);
	if (raw === undefined) return undefined;
	const cacheRead = asNumber(raw.cachedReadTokens);
	const cacheWrite = asNumber(raw.cachedWriteTokens);
	const thought = asNumber(raw.thoughtTokens);
	return {
		input: asNumber(raw.inputTokens) ?? 0,
		output: asNumber(raw.outputTokens) ?? 0,
		...(cacheRead !== undefined ? { cacheRead } : {}),
		...(cacheWrite !== undefined ? { cacheWrite } : {}),
		...(thought !== undefined ? { thought } : {}),
	};
}

export function addTokenUsage(
	a: TokenUsage | undefined,
	b: TokenUsage | undefined,
): TokenUsage | undefined {
	if (a === undefined) return b;
	if (b === undefined) return a;
	const cacheRead = addOptional(a.cacheRead, b.cacheRead);
	const cacheWrite = addOptional(a.cacheWrite, b.cacheWrite);
	const thought = addOptional(a.thought, b.thought);
	return {
		input: a.input + b.input,
		output: a.output + b.output,
		...(cacheRead !== undefined ? { cacheRead } : {}),
		...(cacheWrite !== undefined ? { cacheWrite } : {}),
		...(thought !== undefined ? { thought } : {}),
	};
}

function addOptional(a: number | undefined, b: number | undefined): number | undefined {
	if (a === undefined) return b;
	return b === undefined ? a : a + b;
}
