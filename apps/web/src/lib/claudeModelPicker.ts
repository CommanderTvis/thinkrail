export interface ModelPickerIo {
	write: (data: string) => void;
	readLines: () => readonly string[];
	delay: (ms: number) => Promise<void>;
}

export type ModelPickerOutcome = "switched" | "no-picker" | "not-found" | "draft";

const ENTER_DELAY_MS = 250;
const POLL_MS = 150;
const OPEN_POLLS = 24;
const MOVE_POLLS = 8;
const MAX_STEPS = 12;

const HIGHLIGHTED_ROW = /^\s*❯\s*\d+\.\s+(.+?)(?:\s{2}.*)?$/;
const COMPOSER_LINE = /^\s*❯\s?(.*)$/;
const COMPOSER_PLACEHOLDER = /^Try "/;
const CONFIRM_PROMPT = /Switch model\?|Change effort level\?/;
const CONFIRM_POLLS = 8;

/** What the user has typed at Claude Code's prompt, read off its composer line; undefined when empty. */
export function composerDraft(lines: readonly string[]): string | undefined {
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i] ?? "";
		if (HIGHLIGHTED_ROW.test(line)) return undefined;
		const match = COMPOSER_LINE.exec(line);
		if (!match) continue;
		const text = (match[1] ?? "").trim();
		return text && !COMPOSER_PLACEHOLDER.test(text) ? text : undefined;
	}
	return undefined;
}

export function pickerHighlight(lines: readonly string[]): string | undefined {
	for (let i = lines.length - 1; i >= 0; i--) {
		const match = HIGHLIGHTED_ROW.exec(lines[i] ?? "");
		const label = match?.[1];
		if (label !== undefined) return label.replace(/✔/g, "").trim();
	}
	return undefined;
}

/**
 * Switching a cached conversation asks first ("Switch model? 1. Yes … 2. No, go back"). The user already
 * answered that by picking from the chip's menu, so the drive answers it rather than leaving a question
 * on screen that nothing is going to press. See lib/SPEC.md.
 */
export function confirmationChoice(lines: readonly string[]): "yes" | "no" | null {
	if (!lines.some((line) => CONFIRM_PROMPT.test(line))) return null;
	const label = pickerHighlight(lines);
	if (label === undefined) return null;
	return /^yes\b/i.test(label) ? "yes" : "no";
}

export function highlightNamesModel(label: string | undefined, model: string): boolean {
	if (label === undefined) return false;
	const name = label.toLowerCase();
	const id = model.toLowerCase();
	return name === id || name.startsWith(`${id} (`);
}

export async function answerConfirmation(io: ModelPickerIo): Promise<void> {
	for (let poll = 0; poll < CONFIRM_POLLS; poll++) {
		await io.delay(POLL_MS);
		const choice = confirmationChoice(io.readLines());
		if (choice === null) continue;
		// The highlight opens on "Yes"; move to it if it did not, then take it.
		if (choice === "no") io.write("\x1b[A");
		io.write("\r");
		await io.delay(POLL_MS);
		return;
	}
}

export async function driveModelPicker(
	io: ModelPickerIo,
	model: string,
): Promise<ModelPickerOutcome> {
	// A slash command only opens the picker at the start of an empty line — see lib/SPEC.md.
	if (composerDraft(io.readLines()) !== undefined) return "draft";
	io.write("/model");
	await io.delay(ENTER_DELAY_MS);
	io.write("\r");
	let label: string | undefined;
	for (let poll = 0; poll < OPEN_POLLS && label === undefined; poll++) {
		await io.delay(POLL_MS);
		label = pickerHighlight(io.readLines());
	}
	if (label === undefined) {
		io.write("\x1b");
		return "no-picker";
	}
	for (let step = 0; step < MAX_STEPS; step++) {
		if (highlightNamesModel(label, model)) {
			io.write("s");
			await answerConfirmation(io);
			return "switched";
		}
		const before = label;
		io.write("\x1b[B");
		for (let poll = 0; poll < MOVE_POLLS && label === before; poll++) {
			await io.delay(POLL_MS);
			label = pickerHighlight(io.readLines());
		}
	}
	io.write("\x1b");
	return "not-found";
}
