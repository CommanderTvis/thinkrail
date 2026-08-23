import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { stagedClaudePlugin } from "./claudePlugin";

test("the plugin sits two levels under its marketplace, which is how the host finds one from the other", () => {
	const staged = stagedClaudePlugin("/app/runtime");
	expect(resolve(staged.pluginDir, "..", "..")).toBe(staged.marketplaceRoot);
	expect(staged.manifest).toBe(join(staged.marketplaceRoot, ".claude-plugin", "marketplace.json"));
});
