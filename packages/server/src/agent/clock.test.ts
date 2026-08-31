import { expect, test } from "bun:test";
import { createStagingClock } from "./clock";

function counting(): () => string {
	let seq = 0;
	return () => {
		seq += 1;
		return `m${seq}`;
	};
}

test("a staged id is handed to the next caller and only to that one", () => {
	const clock = createStagingClock(counting(), () => 1_700_000_000_000);
	clock.stage("held");
	expect(clock.nextId()).toBe("held");
	expect(clock.nextId()).toBe("m1");
});

test("minting an id never eats the staged one", () => {
	const clock = createStagingClock(counting(), () => 0);
	clock.stage("held");
	expect(clock.mint()).toBe("m1");
	expect(clock.nextId()).toBe("held");
});

test("staging twice keeps the newer id — one slot, never a backlog", () => {
	const clock = createStagingClock(counting(), () => 0);
	clock.stage("first");
	clock.stage("second");
	expect(clock.nextId()).toBe("second");
	expect(clock.nextId()).toBe("m1");
});
