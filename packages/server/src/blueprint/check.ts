import { BLUEPRINT_FILE, readBlueprintFile } from "./document";
import { controlsOf, readBlueprint, selectedLabels } from "./format";

export interface BlueprintCheck {
	text: string;
	isError?: boolean;
}

export function checkBlueprint(worktreePath: string): BlueprintCheck {
	const text = readBlueprintFile(worktreePath);
	if (text === null) {
		return {
			text: `There is no ${BLUEPRINT_FILE} at the root of this directory yet — write the file, then check it.`,
			isError: true,
		};
	}

	const { doc, notes } = readBlueprint(text);
	const controls = controlsOf(doc);
	const lines = [
		`${BLUEPRINT_FILE} — ${count(controls.length, "control")}, ${count(notes.length, "note")}.`,
	];
	if (controls.length > 0) {
		lines.push(
			"",
			...controls.map(
				(control) =>
					`${control.id} (${control.kind}) — ${count(control.options.length, "option")}, ${selectedLabels(control)} selected`,
			),
		);
	}
	if (notes.length > 0) {
		lines.push("", "What the panel read differently from what you wrote:");
		lines.push(...notes.map((note) => `- ${note.control}: ${note.message}`));
		lines.push("", `Fix these in ${BLUEPRINT_FILE} and check again.`);
	}
	return { text: lines.join("\n") };
}

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

const DESCRIPTION = `Read back the interactive specification exactly as the reader's panel renders it: every control, its kind, how many options it has, what is selected, and every place the parser had to decide something for you — a kind word it did not know, an id it invented or renamed, an option with no reason after it. Call this after writing or rewriting ${BLUEPRINT_FILE}. It reads the file and changes nothing.`;

export function blueprintCheckMcpTool(cwd: string): {
	name: string;
	description: string;
	inputSchema: object;
	call(): Promise<BlueprintCheck>;
} {
	return {
		name: "blueprint_check",
		description: DESCRIPTION,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		call: async () => checkBlueprint(cwd),
	};
}

export { DESCRIPTION as BLUEPRINT_CHECK_DESCRIPTION };
