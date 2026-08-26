import { describe, expect, it } from "bun:test";
import type { BlueprintControl } from "@thinkrail/contracts";
import { blueprintBlockLines, controlsOf, parseBlueprint, serializeBlueprint } from "./format";

const DOC = `# Lightbulb control

A small app for switching your lights on and off.

!control select transport
= Zigbee — works without the vendor cloud
- Wi-Fi — cheapest bulbs, no hub needed
- Matter — most future-proof

## Running it

It runs on a box in your hallway.

!control select hosting
- Raspberry Pi — cheapest to leave running
= Docker on a NAS — most conventional for a home lab
- Nix on bare metal — most reproducible
`;

const only = (text: string): BlueprintControl => {
	const found = controlsOf(parseBlueprint(text));
	expect(found).toHaveLength(1);
	return found[0] as BlueprintControl;
};

describe("parseBlueprint", () => {
	it("reads controls, their axes, and the selected option", () => {
		const controls = controlsOf(parseBlueprint(DOC));
		expect(controls.map((d) => d.id)).toEqual(["transport", "hosting"]);
		expect(controls[0]?.title).toBe("Transport");
		expect(controls[0]?.selectedIds).toEqual(["zigbee"]);
		expect(controls[0]?.options.map((o) => o.axis)).toEqual([
			"works without the vendor cloud",
			"cheapest bulbs, no hub needed",
			"most future-proof",
		]);
	});

	it("keeps the chosen option wherever it sits in the list", () => {
		expect(only(DOC.slice(DOC.indexOf("!control select hosting"))).selectedIds).toEqual([
			"docker-on-a-nas",
		]);
	});

	it("keeps prose and controls in document order", () => {
		expect(parseBlueprint(DOC).blocks.map((b) => b.kind)).toEqual([
			"prose",
			"control",
			"prose",
			"control",
		]);
	});

	it("accepts every separator a model is likely to reach for", () => {
		const control = only(
			"!control select db\n= Postgres: most conventional\n- SQLite - simplest\n",
		);
		expect(control.options.map((o) => [o.label, o.axis])).toEqual([
			["Postgres", "most conventional"],
			["SQLite", "simplest"],
		]);
	});

	it("falls back to the first option when the agent emitted no chosen line", () => {
		expect(
			only("!control select db\n- Postgres — conventional\n- SQLite — simple\n").selectedIds,
		).toEqual(["postgres"]);
	});

	it("survives an option with no axis at all", () => {
		expect(only("!control select db\n= Postgres\n- SQLite\n").options[0]?.axis).toBe("");
	});

	it("suffixes a duplicate id rather than merging two controls", () => {
		const controls = controlsOf(
			parseBlueprint("!control select db\n= A — x\n\n!control select db\n= B — y\n"),
		);
		expect(controls.map((d) => d.id)).toEqual(["db", "db-2"]);
	});

	it("gives an id-less marker a positional id", () => {
		expect(only("!control\n= A — x\n").id).toBe("control-1");
	});
});

describe("parseBlueprint mid-stream", () => {
	const prefixes = Array.from({ length: DOC.length }, (_, at) => DOC.slice(0, at + 1));

	it("never throws and never loses an earlier control", () => {
		let seen = 0;
		for (const prefix of prefixes) {
			const controls = controlsOf(parseBlueprint(prefix));
			expect(controls.length).toBeGreaterThanOrEqual(seen === 2 ? 1 : 0);
			seen = Math.max(seen, controls.length);
			for (const control of controls) expect(control.id).not.toBe("");
		}
		expect(seen).toBe(2);
	});

	it("shows a block whose options have not arrived yet as pending", () => {
		const control = only("Intro.\n\n!control select transport\n");
		expect(control.pending).toBe(true);
		expect(control.options).toEqual([]);
	});

	it("holds back a half-typed option line but lets prose stream word by word", () => {
		expect(only("!control select transport\n= Zigbee — works\n- Wi-F").options).toHaveLength(1);
		expect(parseBlueprint("A small app for switching").blocks[0]).toMatchObject({
			kind: "prose",
			text: "A small app for switching",
		});
	});

	it("hides a half-typed marker instead of rendering it as prose", () => {
		expect(parseBlueprint("Intro.\n\n!deci").blocks).toMatchObject([
			{ kind: "prose", text: "Intro." },
		]);
	});
});

describe("serializeBlueprint", () => {
	it("round-trips a document without moving anything", () => {
		expect(parseBlueprint(serializeBlueprint(parseBlueprint(DOC)))).toEqual(parseBlueprint(DOC));
	});

	it("marks the chosen option in place rather than reordering the list", () => {
		const doc = parseBlueprint(DOC);
		const text = serializeBlueprint(doc);
		expect(text).toContain("- Raspberry Pi — cheapest to leave running\n= Docker on a NAS");
	});
});

describe("multi controls", () => {
	const MULTI = `!control multi deploy-as
[x] Docker image — most portable
[ ] Docker Compose — easiest local multi-service
[x] Nix flake — most reproducible
`;

	it("reads every checked option, in document order", () => {
		const control = only(MULTI);
		expect(control.kind).toBe("multi");
		expect(control.selectedIds).toEqual(["docker-image", "nix-flake"]);
		expect(control.options.map((o) => o.label)).toEqual([
			"Docker image",
			"Docker Compose",
			"Nix flake",
		]);
	});

	it("accepts none checked — a set can be empty, unlike a choice", () => {
		expect(only("!control multi targets\n[ ] A — x\n[ ] B — y\n").selectedIds).toEqual([]);
	});

	it("round-trips checkbox syntax rather than degrading it to a select", () => {
		expect(serializeBlueprint(parseBlueprint(MULTI))).toContain("[x] Docker image");
		expect(serializeBlueprint(parseBlueprint(MULTI))).toContain("[ ] Docker Compose");
	});

	it("infers the kind from the option syntax when the agent omits it", () => {
		expect(only("!control deploy-as\n[x] A — x\n[ ] B — y\n").kind).toBe("multi");
		expect(only("!control db\n= A — x\n- B — y\n").kind).toBe("select");
	});

	it("takes an unknown kind word as the id rather than losing the control", () => {
		const control = only("!control database\n= Postgres — conventional\n");
		expect(control.id).toBe("database");
		expect(control.kind).toBe("select");
	});

	it("keeps a select to one selection even when the agent marks two", () => {
		expect(only("!control select db\n= A — x\n= B — y\n").selectedIds).toEqual(["a"]);
	});
});

describe("spec-graph frontmatter", () => {
	const WITH_FM = `---
id: cat-market
type: goal-and-requirements
status: draft
title: Cat market
---

Intro.

!control select language
= Python — most conventional
- Haskell — strongest types
`;

	it("keeps frontmatter off the rendered document", () => {
		const doc = parseBlueprint(WITH_FM);
		expect(doc.blocks.map((block) => block.kind)).toEqual(["prose", "control"]);
		expect(doc.blocks[0]).toMatchObject({ kind: "prose", text: "Intro." });
	});

	it("round-trips it verbatim, so the file stays a Specs node", () => {
		expect(serializeBlueprint(parseBlueprint(WITH_FM))).toStartWith("---\nid: cat-market\n");
		expect(parseBlueprint(serializeBlueprint(parseBlueprint(WITH_FM)))).toEqual(
			parseBlueprint(WITH_FM),
		);
	});

	it("leaves a document without frontmatter alone", () => {
		expect(parseBlueprint("Intro.\n").frontmatter).toBe("");
		expect(serializeBlueprint(parseBlueprint("Intro.\n"))).toBe("Intro.\n");
	});
});

describe("blueprintBlockLines", () => {
	const linesOf = (text: string) => {
		const doc = parseBlueprint(text);
		const spans = blueprintBlockLines(doc);
		const file = serializeBlueprint(doc).split("\n");
		return { doc, spans, file };
	};

	it("names the lines a block actually occupies in the serialized file", () => {
		const { doc, spans, file } = linesOf(
			"# Goal\n\nA marketplace for cats.\n\n!control select platform\n= iOS\n- Android\n\nClosing prose.\n",
		);
		for (const block of doc.blocks) {
			const span = spans.get(block.id);
			if (!span) throw new Error(`no span for ${block.id}`);
			const rendered = file.slice(span.startLine - 1, span.endLine).join("\n");
			const expected = block.kind === "prose" ? block.text : `!control select ${block.control.id}`;
			expect(rendered.startsWith(expected.split("\n")[0] ?? "")).toBe(true);
		}
	});

	it("counts the frontmatter, because the agent reads the whole file", () => {
		const bare = linesOf("Just prose.\n");
		const stamped = linesOf("---\nid: spec\ntype: task-spec\n---\n\nJust prose.\n");
		const first = (r: ReturnType<typeof linesOf>) =>
			r.spans.get(r.doc.blocks[0]?.id ?? "")?.startLine;
		expect(first(bare)).toBe(1);
		expect(first(stamped)).toBe(5);
		expect(stamped.file[(first(stamped) ?? 1) - 1]).toBe("Just prose.");
	});

	it("spans every line of a multi-line block, not just its first", () => {
		const { doc, spans, file } = linesOf("!control multi deploy\n[x] Docker\n[ ] Nix\n");
		const span = spans.get(doc.blocks[0]?.id ?? "");
		expect(span).toEqual({ startLine: 1, endLine: 3 });
		expect(file.slice(0, 3)).toEqual(["!control multi deploy", "[x] Docker", "[ ] Nix"]);
	});
});
