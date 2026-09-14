import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectHasSpecs } from "./specs";

test("projectHasSpecs ignores ephemeral task-specs — only a durable spec signals 'set up'", () => {
	const root = mkdtempSync(join(tmpdir(), "trpi-proj-test-"));
	try {
		writeFileSync(
			join(root, "TASK-x.md"),
			"---\nid: task-x\ntype: task-spec\ntitle: Scratch\n---\n\n## Body\n",
		);
		expect(projectHasSpecs(root)).toBe(false);

		writeFileSync(
			join(root, "SPEC.md"),
			"---\nid: real\ntype: module-design\ntitle: Real\n---\n\n## Body\n",
		);
		expect(projectHasSpecs(root)).toBe(true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("projectHasSpecs degrades to false rather than throwing on a glob/parse failure", () => {
	expect(projectHasSpecs("/nonexistent/thinkrail-spec-root")).toBe(false);
});
