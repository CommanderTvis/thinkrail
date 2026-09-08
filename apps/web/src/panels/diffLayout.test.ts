import { expect, test } from "bun:test";
import { narrowForSplit } from "./diffLayout";

test("a pane whose halves fit fewer than 40 columns defaults to inline", () => {
	expect(narrowForSplit(400, 11)).toBe(true);
	expect(narrowForSplit(660, 11)).toBe(true);
	expect(narrowForSplit(700, 11)).toBe(false);
	expect(narrowForSplit(1200, 11)).toBe(false);
});

test("a larger font needs a wider pane before split is offered by default", () => {
	expect(narrowForSplit(700, 14)).toBe(true);
	expect(narrowForSplit(900, 14)).toBe(false);
});

test("an unmeasured pane is not treated as narrow", () => {
	expect(narrowForSplit(0, 11)).toBe(false);
});
