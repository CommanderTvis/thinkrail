import type { BlueprintDoc, BlueprintEdit, BlueprintSource } from "@thinkrail/contracts";
import { BLUEPRINT_FILE } from "./document";
import { controlsOf, selectedLabels } from "./format";
import { describeEdit } from "./reconcile";

export const BLUEPRINT_APPENDIX = `You are drafting an interactive specification with the person you are talking to. It lives in a single file, \`${BLUEPRINT_FILE}\`, at the root of this directory. Write it there and keep it there: they are reading that file, rendered, in a panel beside this conversation.

Begin the file with frontmatter, so it registers as a node of the project's spec graph and shows up in the Specs tool. \`status\` starts at \`draft\`; a spec becomes \`active\` once its design firms up:

---
id: a-kebab-case-id-for-this-spec
type: goal-and-requirements
status: draft
title: A short name for what is being built
tags: [product, scope]
---

Then structure it the way this project's own specs are structured — \`## Goal\` (what it is, who it is for, in a few sentences), then the substance, then \`## Decisions\`, then \`## Invariants\` for the things that must stay true, then \`## Out of scope\` for what is deliberately not being built. Prose is the argument, not decoration: a decision says what it buys, and headings do not stand in for it. Write in plain declarative sentences; skip adjectives that carry no information.

Then it is Markdown, plus one construct. Wherever the design makes a real choice — a language, a datastore, a protocol, a hosting model, an auth model — do not hedge in prose. Pick one, and record it as a control block written exactly like this, on its own lines, with a blank line before and after:

!control select stable-kebab-case-id
= Chosen option — the one property that makes it the right pick
- Alternative — the one property that would make you pick it instead
- Alternative — the one property that would make you pick it instead

Where the answer is "any number of these, not exactly one" — deploy targets, supported platforms, integrations to ship — use the other kind, which is the same block with checkboxes instead:

!control multi stable-kebab-case-id
[x] An option you are including — why it earns its place
[ ] An option you are leaving out — what would make you add it
[x] Another option you are including — why it earns its place

Give two to four options either way, and always fill in the reason after the em dash: they choose along a property ("fastest", "widest plugin ecosystem", "most conventional", "cheapest at idle"), not by recognising a name. This is also how this project records **rejected alternatives** — the options you did not take are not deleted, they stay with the reason someone would take them instead, so the argument survives the decision. The id names the *question*, never the answer (\`database\`, not \`postgres\`), and it must stay byte-identical every time you rewrite the file. Never leave a value blank and never ask them a question in the document — every decision is already made, and they change the two they care about.

The panel renders GitHub-flavoured Markdown, and the document should use what it renders. Every code fence names its language — \`\`\`shell, \`\`\`kotlin, \`\`\`json, \`\`\`yaml — so it is highlighted rather than shown as grey text; a bare \`\`\` is a fence with its language left blank. A comparison of two or more things across the same properties is a table. A list of steps someone will tick off is a task list (\`- [ ]\`). A caveat that must not be skimmed past is a callout: a blockquote opening with \`[!NOTE]\`, \`[!TIP]\`, \`[!IMPORTANT]\`, \`[!WARNING]\` or \`[!CAUTION]\` on its first line. When a picture carries the argument better than a paragraph — the shape of the system, the path a request takes, a state machine — draw it as a Mermaid diagram in a \`\`\`mermaid fence; the panel renders it. Never draw ASCII art: boxes and arrows typed into a code block do not wrap, cannot be read at the width of a panel, and are a diagram only to a monospace font.

After you write the file, and after every rewrite of it, call \`blueprint_check\`. It reads \`${BLUEPRINT_FILE}\` back the way the panel renders it and names anything the parser had to decide for you — a kind word it did not know, an id it invented or renamed, an option with no reason after it. Fix what it reports before you answer.

They can also change it from the panel: flipping a control or rewriting a passage edits \`${BLUEPRINT_FILE}\` directly and then tells you what changed. When that happens, re-read the file and bring the rest of the document back into line with it — some changes drag half the spec with them and some touch nothing, and that judgement is yours. Keep what they set exactly as they set it.`;

const COVERAGE = `Cover what it is, who it is for, the shape of the system, and how it is built and run. Aim for at least six control blocks spread through the document, and reach for \`multi\` wherever the honest answer is a set rather than a single pick.`;

const TAKEOVER = `Every decision that is already made is the control's **selected** option, written the way it actually is — not the way it should have been. The alternatives are the ones a rewrite would seriously consider, each with the property that would make someone switch to it: this document is what a person reads before deciding to move off what is there. Do not invent a decision to fill a slot; a question the source does not answer is not a control.`;

export function openingPrompt(source: BlueprintSource): string {
	if (source.kind === "product") {
		return `Read this project and write down the specification it is already living by, into ${BLUEPRINT_FILE}.

Work from the code: the build files and dependency manifests, the entrypoints, the configuration, how it is deployed and tested. ${COVERAGE}

${TAKEOVER}

Read first, then write the file, then tell me in one line what this project turned out to be — do not paste the document into this conversation.`;
	}

	if (source.kind === "spec") {
		return `Read ${source.path} and write it out as an interactive specification, into ${BLUEPRINT_FILE}.

Keep what it says. Its prose is the argument and stays the argument; what changes is that every decision buried in it becomes a control someone can change. Where it states a choice, that is the selected option; where it hedges between two, pick the one the rest of the document assumes. ${COVERAGE}

${TAKEOVER}

Leave ${source.path} exactly as it is — it is the source, not the draft. Write the file, then tell me in one line what it turned out to specify — do not paste the document into this conversation.`;
	}

	return `Write the interactive specification for this idea, into ${BLUEPRINT_FILE}:

${source.brief.trim()}

${COVERAGE} Write the file first, then tell me in one line what you chose to build — do not paste the document into this conversation.`;
}

/** The one line the panel shows above the document: what this spec was made from. */
export function describeSource(source: BlueprintSource): string {
	if (source.kind === "product") return "Taken over from this project's code";
	if (source.kind === "spec") return `Taken over from ${source.path}`;
	return source.brief.trim();
}

/** What ThinkRail says to the author after the reader changed the file from the panel. */
export function reconcilePrompt(
	doc: BlueprintDoc,
	changedIds: readonly string[],
	edits: readonly BlueprintEdit[],
): string {
	const changed = controlsOf(doc).filter((control) => changedIds.includes(control.id));
	const selections = changed.map(
		(control) => `- ${control.id} is now "${selectedLabels(control)}"`,
	);
	const rewrites = edits.map((edit) => `- ${describeEdit(doc, edit)}`);

	return `I changed ${BLUEPRINT_FILE} from the panel:
${[...selections, ...rewrites].join("\n")}

Re-read the file and bring the rest of the document back into line with that. Keep those changes exactly as they are, keep every control id byte-identical, and write the result back to ${BLUEPRINT_FILE}. Answer here in one line — do not paste the document.`;
}
