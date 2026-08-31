import { expect, test } from "bun:test";
import { SessionRegistry } from "./sessions";
import { toStopReason } from "./updates";

test("an open session is reachable by id and by cwd, and reopening keeps its translator", () => {
	const registry = new SessionRegistry();
	const first = registry.open("s1", "/repo");
	expect(registry.open("s1", "/repo")).toBe(first);
	expect(registry.cwdOf("s1")).toBe("/repo");
});

test("a listed session is deletable without ever having been opened", () => {
	const registry = new SessionRegistry();
	registry.note("s2", "/repo");
	expect(registry.get("s2")).toBeUndefined();
	expect(registry.cwdOf("s2")).toBe("/repo");
});

test("closing a session settles its in-flight prompt as cancelled, not as a finished turn", async () => {
	const registry = new SessionRegistry();
	registry.open("s1", "/repo");
	const settled = registry.settled("s1");
	registry.drop("s1");
	const settlement = await settled;
	expect(toStopReason(settlement?.stopReason)).toBe("cancelled");
	expect(registry.cwdOf("s1")).toBeUndefined();
});

test("a lost connection settles every waiting prompt", async () => {
	const registry = new SessionRegistry();
	registry.open("s1", "/repo");
	registry.open("s2", "/repo");
	const waiting = Promise.all([registry.settled("s1"), registry.settled("s2")]);
	registry.clear();
	expect((await waiting).map((entry) => toStopReason(entry?.stopReason))).toEqual([
		"cancelled",
		"cancelled",
	]);
});
