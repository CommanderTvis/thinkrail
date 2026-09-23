import { expect, test } from "bun:test";
import { formatTokens, tokenUsageParts } from "./tokenUsage";

test("token counts use pi's compact thresholds", () => {
	expect([999, 1_200, 12_345, 1_200_000, 10_400_000].map(formatTokens)).toEqual([
		"999",
		"1.2k",
		"12k",
		"1.2M",
		"10M",
	]);
});

test("usage parts keep pi's order and omit zero fields", () => {
	expect(
		tokenUsageParts({ input: 12_345, output: 342, cacheRead: 10_400_000, cacheWrite: 83_000 }),
	).toEqual(["↑12k", "↓342", "R10M", "W83k"]);
	expect(tokenUsageParts({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toEqual([]);
});
