import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBlueprint } from "./check";
import { BLUEPRINT_FILE } from "./document";
import { readBlueprint } from "./format";

function worktreeWith(text: string | null): string {
	const dir = mkdtempSync(join(tmpdir(), "trbp-check-"));
	if (text !== null) writeFileSync(join(dir, BLUEPRINT_FILE), text, "utf8");
	return dir;
}

describe("what the parser decided for the author", () => {
	it("says nothing about a document written the way the appendix asks", () => {
		const { notes } = readBlueprint(
			`!control select database\n= Postgres — most conventional\n- SQLite — simplest\n`,
		);
		expect(notes).toEqual([]);
	});

	it("reports the kind word it did not know, and the id that word cost", () => {
		const { doc, notes } = readBlueprint(`!control scale throughput\n= One box — simplest\n`);
		expect(doc.blocks[0]).toMatchObject({ kind: "control", id: "scale" });
		expect(notes).toHaveLength(1);
		expect(notes[0]?.message).toContain('"throughput" was dropped');
		expect(notes[0]?.message).toContain("!control select throughput");
	});

	it("reports a positional id, because a later rewrite moves the reader's choice with it", () => {
		const { notes } = readBlueprint(`!control\n= One box — simplest\n`);
		expect(notes[0]).toMatchObject({ control: "control-1" });
		expect(notes[0]?.message).toContain("by position");
	});

	it("reports a duplicate id and the name the second one actually answers to", () => {
		const { notes } = readBlueprint(
			`!control select database\n= Postgres — conventional\n\n!control select database\n= Redis — fastest\n`,
		);
		expect(notes).toHaveLength(1);
		expect(notes[0]).toMatchObject({ control: "database-2" });
		expect(notes[0]?.message).toContain('"database" is already taken');
	});

	it("reports an option with no reason after it — the axis is what the reader picks along", () => {
		const { notes } = readBlueprint(`!control select database\n= Postgres\n- SQLite — simplest\n`);
		expect(notes).toHaveLength(1);
		expect(notes[0]?.message).toContain("has no reason after it");
	});

	it("reports a control the author opened and never filled", () => {
		const { notes } = readBlueprint(`!control select database\n\nSome prose.\n`);
		expect(notes).toHaveLength(1);
		expect(notes[0]?.message).toContain("no option lines");
	});
});

describe("blueprint_check", () => {
	it("reads the controls back the way the panel renders them", () => {
		const dir = worktreeWith(
			`---\nid: thing\n---\n\n# Thing\n\n!control select database\n= Postgres — most conventional\n- SQLite — simplest\n\n!control multi deploy\n[x] Docker — most portable\n[ ] Nix — most reproducible\n`,
		);
		try {
			const { text, isError } = checkBlueprint(dir);
			expect(isError).toBeUndefined();
			expect(text).toContain("2 controls, 0 notes");
			expect(text).toContain("database (select) — 2 options, Postgres selected");
			expect(text).toContain("deploy (multi) — 2 options, Docker selected");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("lists every note under one heading, and asks for another pass", () => {
		const dir = worktreeWith(`!control scale throughput\n= One box\n`);
		try {
			const { text } = checkBlueprint(dir);
			expect(text).toContain("1 control, 2 notes");
			expect(text).toContain("What the panel read differently");
			expect(text).toContain("check again");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("a missing file is an error, not an empty report — the author wrote nowhere", () => {
		const dir = worktreeWith(null);
		try {
			const { text, isError } = checkBlueprint(dir);
			expect(isError).toBe(true);
			expect(text).toContain(BLUEPRINT_FILE);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
