import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BlueprintState } from "@thinkrail/contracts";
import { blueprintPath } from "./document";
import { controlsOf } from "./format";
import {
	closeBlueprint,
	confirmBlueprintEdits,
	discardBlueprintEdits,
	editBlueprintText,
	getBlueprint,
	noteBlueprintAuthorSession,
	noteBlueprintFileChanged,
	openBlueprint,
	resetBlueprintsForTest,
	selectBlueprintOption,
	setBlueprintAuthor,
	setBlueprintPublisher,
} from "./session";

const WS = "ws-blueprint";

const DOC = `Intro.

!control select language
= Python — most conventional
- Haskell — strongest types

!control multi deploy-as
[x] Docker image — most portable
[ ] Nix flake — most reproducible
`;

let worktree: string;
let frames: BlueprintState[] = [];

const latest = (): BlueprintState => {
	const frame = frames.at(-1);
	if (!frame) throw new Error("no blueprint frame was published");
	return frame;
};

const onDisk = () => readFileSync(blueprintPath(worktree), "utf8");
const writeDoc = (text: string) => writeFileSync(blueprintPath(worktree), text, "utf8");

const opened = () => {
	openBlueprint(WS, worktree, { kind: "idea", brief: "brief" }, "pi");
	writeDoc(DOC);
	noteBlueprintFileChanged(WS);
};

setBlueprintPublisher((payload) => frames.push(payload.state));

beforeEach(() => {
	worktree = mkdtempSync(join(tmpdir(), "trpi-blueprint-"));
	frames = [];
});

afterEach(() => {
	resetBlueprintsForTest();
	rmSync(worktree, { recursive: true, force: true });
});

test("a blueprint with no file yet is awaiting its author, not broken", () => {
	const state = openBlueprint(WS, worktree, { kind: "idea", brief: "an app to sell cats" }, "pi");

	expect(state.phase).toBe("awaiting");
	expect(state.doc.blocks).toEqual([]);
	expect(state.author).toBeNull();
});

test("the panel reads whatever the author wrote to the file", () => {
	opened();

	expect(latest().phase).toBe("ready");
	expect(controlsOf(latest().doc).map((control) => control.id)).toEqual(["language", "deploy-as"]);
	expect(controlsOf(latest().doc)[1]?.kind).toBe("multi");
});

test("a rewrite by the author is reported as the set of things that moved", () => {
	opened();

	writeDoc(
		DOC.replace("= Python — most conventional", "- Python — most conventional").replace(
			"- Haskell — strongest types",
			"= Haskell — strongest types",
		),
	);
	noteBlueprintFileChanged(WS);

	expect(latest().changes).toEqual([
		{
			kind: "control-reselected",
			controlId: "language",
			title: "Language",
			from: "Python",
			to: "Haskell",
		},
	]);
});

test("changing a control writes the file and hands back what the author must be told", () => {
	opened();

	const reconcile = selectBlueprintOption(WS, "language", "haskell");

	expect(onDisk()).toContain("= Haskell — strongest types");
	expect(onDisk()).toContain("- Python — most conventional");
	expect(reconcile).toContain('language is now "Haskell"');
	expect(reconcile).toContain("BLUEPRINT.md");
	expect(controlsOf(latest().doc)[0]?.selectedIds).toEqual(["haskell"]);
});

test("a checkbox toggles rather than replaces, and the file keeps its syntax", () => {
	opened();

	selectBlueprintOption(WS, "deploy-as", "nix-flake");

	expect(onDisk()).toContain("[x] Docker image");
	expect(onDisk()).toContain("[x] Nix flake");
});

test("text edits stage without touching the file; confirming writes it and tells the author", () => {
	opened();

	editBlueprintText(WS, { kind: "prose", blockId: "prose-0" }, "We are shipping this on Nix.");
	expect(latest().pendingEdits).toHaveLength(1);
	expect(onDisk()).toContain("Intro.");
	expect(onDisk()).not.toContain("We are shipping this on Nix.");

	const reconcile = confirmBlueprintEdits(WS);

	expect(onDisk()).toContain("We are shipping this on Nix.");
	expect(reconcile).toContain("We are shipping this on Nix.");
	expect(latest().pendingEdits).toEqual([]);
});

test("reverting staged text goes back to what is actually on disk", () => {
	opened();

	editBlueprintText(WS, { kind: "prose", blockId: "prose-0" }, "Rewritten.");
	discardBlueprintEdits(WS);

	expect(latest().pendingEdits).toEqual([]);
	expect(latest().doc.blocks[0]).toMatchObject({ text: "Intro." });
	expect(confirmBlueprintEdits(WS)).toBeNull();
});

test("a locked choice survives the author rewriting the file around it", () => {
	opened();
	selectBlueprintOption(WS, "language", "haskell");

	// The author writes the file back with its own pick — the reader's stands.
	writeDoc(DOC);
	noteBlueprintFileChanged(WS);

	expect(controlsOf(latest().doc)[0]?.selectedIds).toEqual(["haskell"]);
});

test("a workspace with no blueprint reads as none, and refuses to be changed", () => {
	expect(getBlueprint("ws-without-one")).toBeNull();
	expect(() => selectBlueprintOption("ws-without-one", "language", "haskell")).toThrow(
		/No blueprint/,
	);
});

test("the first sight of a document is the document, not a list of nine things moving", () => {
	opened();

	expect(latest().phase).toBe("ready");
	expect(latest().changes).toEqual([]);
});

test("a blueprint outlives the process: brief and author come back from disk", () => {
	openBlueprint(WS, worktree, { kind: "idea", brief: "an app to sell cats" }, "claude");
	setBlueprintAuthor(WS, { kind: "terminal", tabKey: "blueprint-author" });
	writeDoc(DOC);

	// A restart loses every live session but not the record.
	resetBlueprintsForTest();
	expect(getBlueprint(WS)).toBeNull();

	const restored = getBlueprint(WS, worktree);
	expect(restored?.brief).toBe("an app to sell cats");
	expect(restored?.agentId).toBe("claude");
	expect(restored?.author).toEqual({ kind: "terminal", tabKey: "blueprint-author" });
	expect(controlsOf(restored?.doc ?? { blocks: [], frontmatter: "" })).toHaveLength(2);
});

test("closing a blueprint forgets it, leaving the file behind", () => {
	openBlueprint(WS, worktree, { kind: "idea", brief: "brief" }, "pi");
	writeDoc(DOC);
	closeBlueprint(WS);

	expect(getBlueprint(WS, worktree)).toBeNull();
	expect(onDisk()).toContain("!control select language");
});

test("Claude's own session id is recorded on the author, and survives a restart", () => {
	openBlueprint(WS, worktree, { kind: "idea", brief: "brief" }, "claude");
	setBlueprintAuthor(WS, { kind: "terminal", tabKey: "blueprint-author" });
	noteBlueprintAuthorSession(WS, "blueprint-author", "claude-session-7");

	resetBlueprintsForTest();
	const restored = getBlueprint(WS, worktree);

	expect(restored?.author).toEqual({
		kind: "terminal",
		tabKey: "blueprint-author",
		agentSessionId: "claude-session-7",
	});
});

test("a session id for some other tab is not mistaken for the author's", () => {
	openBlueprint(WS, worktree, { kind: "idea", brief: "brief" }, "claude");
	setBlueprintAuthor(WS, { kind: "terminal", tabKey: "blueprint-author" });
	noteBlueprintAuthorSession(WS, "some-other-terminal", "claude-session-9");

	expect(getBlueprint(WS)?.author).toEqual({ kind: "terminal", tabKey: "blueprint-author" });
});
