import { describe, expect, test } from "bun:test";
import { reviewerTermination } from "./reviewerSessionMonitor";

describe("reviewerTermination", () => {
	test.each([
		["completed", "no-verdict"],
		["refused", "no-verdict"],
		["maxRequests", "no-verdict"],
		["maxTokens", "crashed"],
		["failed", "crashed"],
		["cancelled", "aborted"],
	] as const)("stopReason %s → %p", (stopReason, verdict) => {
		expect(reviewerTermination({ stopReason })).toBe(verdict);
	});

	test("an error message is a crash regardless of the stop reason", () => {
		expect(reviewerTermination({ stopReason: "completed", error: "boom" })).toBe("crashed");
	});

	test("a missing settlement still reads as a verdict that never came", () => {
		expect(reviewerTermination(null)).toBe("no-verdict");
	});
});
