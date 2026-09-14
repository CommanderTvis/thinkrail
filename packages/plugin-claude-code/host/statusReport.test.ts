import { describe, expect, test } from "bun:test";
import { parseStatusDelivery } from "./statusReport";

describe("parseStatusDelivery", () => {
	test("resolves a known event to its status", () => {
		const delivery = parseStatusDelivery({ event: "prompt_submit", session_id: "s1" });
		expect(delivery).not.toBe("unreadable");
		if (delivery === "unreadable") return;
		expect(delivery.status).toBe("running");
		expect(delivery.report.session_id).toBe("s1");
	});

	test("a facts-only event resolves to a null status without being refused", () => {
		const delivery = parseStatusDelivery({ event: "model_switch", model: "opus" });
		expect(delivery).not.toBe("unreadable");
		if (delivery === "unreadable") return;
		expect(delivery.status).toBeNull();
		expect(delivery.report.model).toBe("opus");
	});

	test("refuses a body with no event", () => {
		expect(parseStatusDelivery({})).toBe("unreadable");
		expect(parseStatusDelivery(null)).toBe("unreadable");
	});

	test("refuses an event this version does not know", () => {
		expect(parseStatusDelivery({ event: "something_future" })).toBe("unreadable");
	});
});
