import { expect, test } from "bun:test";
import { openUiThenStartAttribution } from "./attributionReadiness";

test("CLI attribution waits for delayed launcher readiness and follows the normal UI open", async () => {
	const calls: string[] = [];
	await Bun.sleep(1_100);
	expect(calls).toEqual([]);

	await openUiThenStartAttribution(
		true,
		"http://localhost:24242",
		(url) => calls.push(`ui:${url}`),
		() => calls.push("claim"),
		async () => false,
	);
	expect(calls).toEqual(["ui:http://localhost:24242", "claim"]);
});

test("CLI --no-open neither opens the UI nor signals attribution readiness", async () => {
	const calls: string[] = [];
	await openUiThenStartAttribution(
		false,
		"http://localhost:24242",
		() => calls.push("ui"),
		() => calls.push("claim"),
		async () => false,
	);
	expect(calls).toEqual([]);
});

test("CLI leaves an already-connected tab alone but still signals attribution readiness", async () => {
	const calls: string[] = [];
	await openUiThenStartAttribution(
		true,
		"http://localhost:24242",
		() => calls.push("ui"),
		() => calls.push("claim"),
		async () => true,
	);
	expect(calls).toEqual(["claim"]);
});
