import { describe, expect, it } from "bun:test";
import { controlsOf, parseBlueprint } from "./format";
import { applySelection, applyTextEdit, carryOverLocks, diffBlueprints, textAt } from "./reconcile";

const BASE = parseBlueprint(`Intro paragraph.

!control select language
= Python — most conventional
- Haskell — strongest type system

!control select packaging
= Docker — widest hosting
- Nix — most reproducible
`);

const control = (doc: ReturnType<typeof parseBlueprint>, id: string) =>
	controlsOf(doc).find((entry) => entry.id === id);

describe("applySelection", () => {
	it("switches the choice and locks it", () => {
		const next = control(applySelection(BASE, "language", "haskell"), "language");
		expect(next?.selectedIds).toEqual(["haskell"]);
		expect(next?.locked).toBe(true);
	});

	it("ignores an option the control does not offer", () => {
		expect(control(applySelection(BASE, "language", "rust"), "language")?.selectedIds).toEqual([
			"python",
		]);
	});
});

describe("carryOverLocks", () => {
	const locked = applySelection(BASE, "language", "haskell");

	it("re-asserts a locked choice the agent tried to re-decide", () => {
		const rewritten = parseBlueprint(
			"!control select language\n= Python — most conventional\n- Haskell — strongest type system\n",
		);
		const merged = control(carryOverLocks(locked, rewritten), "language");
		expect(merged?.selectedIds).toEqual(["haskell"]);
		expect(merged?.locked).toBe(true);
	});

	it("puts back a locked option the agent dropped from the list", () => {
		const rewritten = parseBlueprint("!control select language\n= Python — most conventional\n");
		const merged = control(carryOverLocks(locked, rewritten), "language");
		expect(merged?.selectedIds).toEqual(["haskell"]);
		expect(merged?.options.map((option) => option.id)).toEqual(["haskell", "python"]);
	});

	it("lets an untouched median default be re-decided freely", () => {
		const rewritten = parseBlueprint("!control select packaging\n= Nix — most reproducible\n");
		expect(control(carryOverLocks(locked, rewritten), "packaging")?.selectedIds).toEqual(["nix"]);
	});
});

describe("diffBlueprints", () => {
	it("names every control that moved, not just the one the reader touched", () => {
		const next = parseBlueprint(`Rewritten intro.

!control select language
= Haskell — strongest type system
- Python — most conventional

!control select packaging
= Nix — most reproducible
- Docker — widest hosting

!control select build
= Cabal — the default
- Stack — most reproducible
`);
		expect(diffBlueprints(BASE, next)).toEqual([
			{
				kind: "control-reselected",
				controlId: "language",
				title: "Language",
				from: "Python",
				to: "Haskell",
			},
			{
				kind: "control-reselected",
				controlId: "packaging",
				title: "Packaging",
				from: "Docker",
				to: "Nix",
			},
			{ kind: "control-added", controlId: "build", title: "Build" },
			{ kind: "prose-changed", count: 1 },
		]);
	});

	it("reports a control the rewrite dropped", () => {
		const next = parseBlueprint(
			"Intro paragraph.\n\n!control select language\n= Python — most conventional\n- Haskell — strongest type system\n",
		);
		expect(diffBlueprints(BASE, next)).toEqual([
			{ kind: "control-removed", controlId: "packaging", title: "Packaging" },
		]);
	});

	it("says nothing changed when the rewrite touched nothing", () => {
		expect(diffBlueprints(BASE, BASE)).toEqual([]);
	});

	it("notices an option list that gained an alternative", () => {
		const next = parseBlueprint(`Intro paragraph.

!control select language
= Python — most conventional
- Haskell — strongest type system

!control select packaging
= Docker — widest hosting
- Nix — most reproducible
- Bare tarball — fewest moving parts
`);
		expect(diffBlueprints(BASE, next)).toEqual([
			{ kind: "control-options-changed", controlId: "packaging", title: "Packaging" },
		]);
	});
});

describe("multi selection", () => {
	const MULTI = parseBlueprint(
		"!control multi deploy-as\n[x] Docker image — portable\n[ ] Nix flake — reproducible\n[ ] Bare tarball — fewest parts\n",
	);

	it("toggles rather than replaces, and keeps document order", () => {
		const on = applySelection(MULTI, "deploy-as", "bare-tarball");
		expect(control(on, "deploy-as")?.selectedIds).toEqual(["docker-image", "bare-tarball"]);

		const off = applySelection(on, "deploy-as", "docker-image");
		expect(control(off, "deploy-as")?.selectedIds).toEqual(["bare-tarball"]);
	});

	it("allows unchecking the last one — an empty set is a legitimate answer", () => {
		const empty = applySelection(MULTI, "deploy-as", "docker-image");
		expect(control(empty, "deploy-as")?.selectedIds).toEqual([]);
		expect(control(empty, "deploy-as")?.locked).toBe(true);
	});

	it("re-asserts every locked checkbox, restoring ones the rewrite dropped", () => {
		const locked = applySelection(MULTI, "deploy-as", "nix-flake");
		const rewritten = parseBlueprint("!control multi deploy-as\n[ ] Docker image — portable\n");
		const merged = control(carryOverLocks(locked, rewritten), "deploy-as");

		expect(merged?.selectedIds).toEqual(["docker-image", "nix-flake"]);
		expect(merged?.options.map((option) => option.id)).toContain("nix-flake");
	});
});

describe("text edits", () => {
	const DOC = parseBlueprint(
		"Intro paragraph.\n\n!control select language\n= Python — most conventional\n- Haskell — strongest types\n",
	);
	const prose = { kind: "prose", blockId: "prose-0" } as const;

	it("rewrites a prose block in place", () => {
		const next = applyTextEdit(DOC, prose, "Rewritten intro.");
		expect(next.blocks[0]).toMatchObject({ kind: "prose", text: "Rewritten intro." });
		expect(textAt(next, prose)).toBe("Rewritten intro.");
	});

	it("replaces the frontmatter block whole, leaving the passages alone", () => {
		const doc = parseBlueprint(`---\ntitle: Probe\n---\n${"Intro paragraph.\n"}`);
		const next = applyTextEdit(doc, { kind: "frontmatter" }, "---\ntitle: Probe 2\n---\n");
		expect(textAt(next, { kind: "frontmatter" })).toBe("---\ntitle: Probe 2\n---\n");
		expect(next.blocks).toEqual(doc.blocks);
	});

	it("moves the selection with an option that was renamed", () => {
		const next = applyTextEdit(
			DOC,
			{ kind: "option-label", controlId: "language", optionId: "python" },
			"Python 3.13",
		);
		const language = control(next, "language");
		expect(language?.options[0]?.id).toBe("python-3-13");
		expect(language?.selectedIds).toEqual(["python-3-13"]);
	});

	it("leaves identity alone when only the axis is rewritten", () => {
		const next = applyTextEdit(
			DOC,
			{ kind: "option-axis", controlId: "language", optionId: "python" },
			"the team already knows it",
		);
		expect(control(next, "language")?.options[0]?.id).toBe("python");
		expect(control(next, "language")?.selectedIds).toEqual(["python"]);
		expect(control(next, "language")?.options[0]?.axis).toBe("the team already knows it");
	});
});
