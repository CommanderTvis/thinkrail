import { describe, expect, it } from "bun:test";
import type { SessionUsage } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { contextPart, formatTokens, SessionStatsBar, usageParts } from "./SessionStatsBar";

const ALL_CAPS = { cost: true, tokenBreakdown: true, contextWindow: true };

function usage(overrides: Partial<SessionUsage> = {}): SessionUsage {
	return { contextUsed: null, contextWindow: null, ...overrides };
}

describe("SessionStatsBar formatting", () => {
	it("matches the compact token thresholds", () => {
		expect([999, 1_200, 12_345, 1_200_000, 10_400_000].map(formatTokens)).toEqual([
			"999",
			"1.2k",
			"12k",
			"1.2M",
			"10M",
		]);
	});

	it("orders the available fields and omits zero-valued token counts", () => {
		expect(
			usageParts(
				usage({
					tokens: { input: 12_345, output: 342, cacheRead: 10_400_000, cacheWrite: 83_000 },
					cost: { amount: 6.85, currency: "USD" },
				}),
				ALL_CAPS,
			),
		).toEqual(["↑12k", "↓342", "R10M", "W83k", "$6.850"]);
		expect(usageParts(usage(), ALL_CAPS)).toEqual([]);
	});

	it("hides the token breakdown or the cost chip when its capability is withheld", () => {
		const value = usage({
			tokens: { input: 12_345, output: 342 },
			cost: { amount: 6.85, currency: "USD" },
		});
		expect(usageParts(value, { cost: false, tokenBreakdown: true })).toEqual(["↑12k", "↓342"]);
		expect(usageParts(value, { cost: true, tokenBreakdown: false })).toEqual(["$6.850"]);
	});

	it("renders the approved five-cell context bar and label from raw used/window tokens", () => {
		expect(contextPart(usage({ contextUsed: 120_000, contextWindow: 200_000 }))).toEqual({
			bar: "▰▰▰▱▱",
			text: "60.0%/200k",
		});
		expect(contextPart(usage({ contextUsed: null, contextWindow: 200_000 }))).toEqual({
			bar: "▱▱▱▱▱",
			text: "?/200k",
		});
	});

	it("has no context bar once the window itself is unknown", () => {
		expect(contextPart(usage({ contextUsed: 1_000, contextWindow: null }))).toBeNull();
	});

	it("separates fields with middle dots and keeps the compact header line unwrapped", () => {
		const value = usage({
			tokens: { input: 12_345, output: 342 },
			cost: { amount: 0.125, currency: "USD" },
			contextUsed: 120_000,
			contextWindow: 200_000,
		});
		const markup = renderToStaticMarkup(SessionStatsBar({ usage: value, capabilities: ALL_CAPS }));
		expect(markup.replace(/<[^>]+>/g, "")).toBe("↑12k·↓342·$0.125·▰▰▰▱▱60.0%/200k");
		expect(markup).toContain("flex-nowrap");
		expect(markup.match(/whitespace-nowrap/g)).toHaveLength(4);
	});
});
