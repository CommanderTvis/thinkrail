import { expect, test } from "bun:test";
import { PLUGIN_API_GENERATION } from "./index";

test("PLUGIN_API_GENERATION is pinned", () => {
	expect(PLUGIN_API_GENERATION).toBe(1);
});
