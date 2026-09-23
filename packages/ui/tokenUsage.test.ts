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

test("units switch by the rounded value so no label reads 10.0k or 1000k", () => {
	expect(
		[9_949, 9_950, 9_999, 999_499, 999_500, 999_999, 9_949_999, 9_950_000].map(formatTokens),
	).toEqual(["9.9k", "10k", "10k", "999k", "1.0M", "1.0M", "9.9M", "10M"]);
	expect(
		[999_499_999, 999_500_000, 1_200_000_000, 9_950_000_000, 12_400_000_000].map(formatTokens),
	).toEqual(["999M", "1.0B", "1.2B", "10B", "12B"]);
});

test("usage parts keep pi's order and omit zero fields", () => {
	expect(
		tokenUsageParts({ input: 12_345, output: 342, cacheRead: 10_400_000, cacheWrite: 83_000 }),
	).toEqual(["↑12k", "↓342", "R10M", "W83k"]);
	expect(tokenUsageParts({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toEqual([]);
});
