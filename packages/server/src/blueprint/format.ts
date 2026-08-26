import type {
	BlueprintBlock,
	BlueprintBlockLines,
	BlueprintControl,
	BlueprintControlKind,
	BlueprintDoc,
	BlueprintOption,
} from "@thinkrail/contracts";

const MARKER = /^\s*!control\b[ \t]*(\S*)[ \t]*(\S*)[ \t]*$/;
const OPTION = /^\s*(?:([=-])|\[([ xX])\])[ \t]+(.*)$/;
const AXIS_SEPARATORS = [" — ", " – ", " -- ", " - ", ": "];

export function slug(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "unnamed"
	);
}

export function humanize(id: string): string {
	const words = id.replace(/-/g, " ").trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function splitOption(body: string): { label: string; axis: string } {
	for (const separator of AXIS_SEPARATORS) {
		const at = body.indexOf(separator);
		if (at > 0) {
			return { label: body.slice(0, at).trim(), axis: body.slice(at + separator.length).trim() };
		}
	}
	return { label: body.trim(), axis: "" };
}

function uniqueId(candidate: string, taken: Set<string>): string {
	if (!taken.has(candidate)) {
		taken.add(candidate);
		return candidate;
	}
	for (let n = 2; ; n++) {
		const suffixed = `${candidate}-${n}`;
		if (!taken.has(suffixed)) {
			taken.add(suffixed);
			return suffixed;
		}
	}
}

/**
 * A partial trailing line is dropped only when it is on its way to becoming syntax; ordinary prose keeps
 * streaming word by word. Hazard: dropping it unconditionally stops the document from feeling live.
 */
function droppedPartial(line: string, inControl: boolean): boolean {
	if (inControl && (OPTION.test(line) || /^\s*\[[ xX]?$/.test(line))) return true;
	const trimmed = line.trimStart();
	if (trimmed.startsWith("!")) return true;
	return "!control".startsWith(trimmed) && trimmed.length > 0;
}

interface OpenControl {
	control: BlueprintControl;
	optionIds: Set<string>;
	selected: string[];
	/** Set when the marker named no kind: the first option line's syntax decides. */
	inferKind: boolean;
}

function splitFrontmatter(text: string): { frontmatter: string; body: string } {
	const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
	return match
		? { frontmatter: match[0], body: text.slice(match[0].length) }
		: { frontmatter: "", body: text };
}

export interface BlueprintNote {
	control: string;
	message: string;
}

export function parseBlueprint(text: string): BlueprintDoc {
	return readBlueprint(text).doc;
}

/** The parse plus what it had to decide for the author; see SPEC.md. */
export function readBlueprint(text: string): { doc: BlueprintDoc; notes: BlueprintNote[] } {
	const { frontmatter, body } = splitFrontmatter(text);
	const lines = body.split("\n");
	const partialIndex = text.endsWith("\n") ? -1 : lines.length - 1;
	const blocks: BlueprintBlock[] = [];
	const takenIds = new Set<string>();
	const notes: BlueprintNote[] = [];
	let prose: string[] = [];
	let open: OpenControl | null = null;

	const flushProse = () => {
		const body = prose
			.join("\n")
			.replace(/^\s*\n/, "")
			.replace(/\s+$/, "");
		prose = [];
		if (body) blocks.push({ kind: "prose", id: `prose-${blocks.length}`, text: body });
	};

	const flushControl = () => {
		if (!open) return;
		const { control, selected } = open;
		control.selectedIds =
			control.kind === "select"
				? selected.slice(0, 1)
				: selected.length > 0
					? selected
					: control.selectedIds;
		if (control.kind === "select" && control.selectedIds.length === 0 && control.options[0]) {
			control.selectedIds = [control.options[0].id];
		}
		control.pending = control.options.length === 0;
		if (control.pending) {
			notes.push({
				control: control.id,
				message: "no option lines — shown as an unfinished control, not a question",
			});
		}
		blocks.push({ kind: "control", id: control.id, control });
		open = null;
	};

	for (const [index, line] of lines.entries()) {
		if (index === partialIndex && droppedPartial(line, open !== null)) continue;

		const marker = MARKER.exec(line);
		if (marker) {
			flushControl();
			flushProse();
			const named = (marker[1] ?? "").toLowerCase();
			const knownKind = named === "select" || named === "multi";
			const rawId = knownKind ? (marker[2] ?? "") : (marker[1] ?? "");
			const wanted = rawId ? slug(rawId) : `control-${blocks.length + 1}`;
			const id = uniqueId(wanted, takenIds);
			if (!knownKind && marker[2]) {
				notes.push({
					control: id,
					message: `"${named}" is not a kind, so it was read as the id and "${marker[2]}" was dropped — write "!control select ${slug(marker[2])}" or "!control multi ${slug(marker[2])}"`,
				});
			}
			if (!rawId) {
				notes.push({
					control: id,
					message: `no id on the marker, so it answers to "${id}" by position — a rewrite that adds a control above it moves the reader's choice to a different question`,
				});
			}
			if (id !== wanted) {
				notes.push({
					control: id,
					message: `"${wanted}" is already taken, so this one answers to "${id}" — the reader's choice on the first is not the one they see here`,
				});
			}
			open = {
				control: {
					id,
					kind: knownKind ? (named as BlueprintControlKind) : "select",
					title: humanize(id),
					options: [],
					selectedIds: [],
					pending: true,
					locked: false,
				},
				optionIds: new Set(),
				selected: [],
				inferKind: !knownKind,
			};
			continue;
		}

		if (open) {
			const option = OPTION.exec(line);
			if (option) {
				const { label, axis } = splitOption(option[3] ?? "");
				if (!label) continue;
				const checkbox = option[2] !== undefined;
				if (open.inferKind) {
					open.control.kind = checkbox ? "multi" : "select";
					open.inferKind = false;
				}
				const id = uniqueId(slug(label), open.optionIds);
				const entry: BlueprintOption = { id, label, axis };
				open.control.options.push(entry);
				if (!axis) {
					notes.push({
						control: open.control.id,
						message: `"${label}" has no reason after it — the reader picks along a property, so write "${label} — why you would pick it"`,
					});
				}
				const chosen = checkbox ? (option[2] ?? "").toLowerCase() === "x" : option[1] === "=";
				if (chosen) open.selected.push(id);
				continue;
			}
			flushControl();
			if (line.trim() === "") continue;
		}

		prose.push(line);
	}

	flushControl();
	flushProse();
	return { doc: { blocks, frontmatter }, notes };
}

function optionLine(control: BlueprintControl, option: BlueprintOption): string {
	const selected = control.selectedIds.includes(option.id);
	const marker = control.kind === "multi" ? (selected ? "[x]" : "[ ]") : selected ? "=" : "-";
	return `${marker} ${option.label}${option.axis ? ` — ${option.axis}` : ""}`;
}

function renderBlock(block: BlueprintBlock): string {
	if (block.kind === "prose") return block.text;
	const { control } = block;
	return [
		`!control ${control.kind} ${control.id}`,
		...control.options.map((option) => optionLine(control, option)),
	].join("\n");
}

export function serializeBlueprint(doc: BlueprintDoc): string {
	return doc.frontmatter + doc.blocks.map(renderBlock).join("\n\n").concat("\n");
}

/**
 * Where each block lands in the serialized file, 1-based and frontmatter-inclusive — the file the agent
 * reads, not the one it was parsed from. Derived from `renderBlock`, the same function
 * `serializeBlueprint` uses, so a layout change cannot move the text without moving these with it.
 */
export function blueprintBlockLines(doc: BlueprintDoc): Map<string, BlueprintBlockLines> {
	const spans = new Map<string, BlueprintBlockLines>();
	let line = doc.frontmatter ? doc.frontmatter.replace(/\n$/, "").split("\n").length + 1 : 1;
	for (const block of doc.blocks) {
		const height = renderBlock(block).split("\n").length;
		spans.set(block.id, { startLine: line, endLine: line + height - 1 });
		line += height + 1;
	}
	return spans;
}

export function controlsOf(doc: BlueprintDoc): BlueprintControl[] {
	return doc.blocks.flatMap((block) => (block.kind === "control" ? [block.control] : []));
}

export function selectedLabels(control: BlueprintControl): string {
	const labels = control.options
		.filter((option) => control.selectedIds.includes(option.id))
		.map((option) => option.label);
	return labels.length > 0 ? labels.join(", ") : "nothing";
}
