export interface ModelPickerIo {
	write: (data: string) => void;
	/** `omitFaint` for what the user typed: a placeholder or suggestion is drawn faint. */
	readLines: (options?: { omitFaint?: boolean }) => readonly string[];
	delay: (ms: number) => Promise<void>;
}

export type ModelPickerOutcome =
	| "switched"
	| "no-picker"
	| "not-found"
	| "no-session-key"
	| "draft";

const ENTER_DELAY_MS = 250;
const POLL_MS = 150;
const OPEN_POLLS = 24;
const MOVE_POLLS = 8;
const MAX_STEPS = 16;

const HIGHLIGHTED_ROW = /^\s*›\s+\d+\.\s+(.+?)(?:\s\((?:current|default)\))?(?:\s{2,}.*)?\s*$/;
const COMPOSER_LINE = /^\s*›\s?(.*)$/;
const PLACEHOLDERS = new Set(["Ask Codex to do anything", "Ask a follow-up question"]);
const EFFORT_TITLE = /Select Reasoning Level/;
const ALL_MODELS = "All models";

/** What the user has typed at Codex's composer; undefined when it is empty or showing its placeholder. */
export function composerDraft(lines: readonly string[]): string | undefined {
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i] ?? "";
		if (HIGHLIGHTED_ROW.test(line)) return undefined;
		const match = COMPOSER_LINE.exec(line);
		if (!match) continue;
		const text = (match[1] ?? "").trim();
		return text && !PLACEHOLDERS.has(text) ? text : undefined;
	}
	return undefined;
}

export function pickerHighlight(lines: readonly string[]): string | undefined {
	for (let i = lines.length - 1; i >= 0; i--) {
		const label = HIGHLIGHTED_ROW.exec(lines[i] ?? "")?.[1];
		if (label !== undefined) return label.trim();
	}
	return undefined;
}

/** Codex shows a model's display name (`GPT-5.6 Luna`, `GPT-6-Astra`); the id is its slug. */
export function highlightNamesModel(label: string | undefined, model: string): boolean {
	return label !== undefined && label.toLowerCase().replace(/\s+/g, "-") === model.toLowerCase();
}

async function settle(io: ModelPickerIo, before: string | undefined): Promise<string | undefined> {
	let label = before;
	for (let poll = 0; poll < MOVE_POLLS && label === before; poll++) {
		await io.delay(POLL_MS);
		label = pickerHighlight(io.readLines());
	}
	return label;
}

async function closed(io: ModelPickerIo): Promise<boolean> {
	for (let poll = 0; poll < MOVE_POLLS; poll++) {
		await io.delay(POLL_MS);
		if (pickerHighlight(io.readLines()) === undefined) return true;
	}
	return false;
}

async function effortOpened(io: ModelPickerIo): Promise<boolean> {
	for (let poll = 0; poll < MOVE_POLLS; poll++) {
		await io.delay(POLL_MS);
		if (io.readLines().some((line) => EFFORT_TITLE.test(line))) return true;
	}
	return false;
}

/**
 * Takes the highlighted model for this session only (`s`), never Enter, which would save it as the
 * user's default in config.toml. A model with a choice of efforts has no session action on its own row:
 * Enter opens its effort list, where the highlighted (current or default) effort takes the `s`. See
 * this package's SPEC.md.
 */
async function acceptForSession(io: ModelPickerIo): Promise<boolean> {
	io.write("s");
	if (await closed(io)) return true;
	io.write("\r");
	if (!(await effortOpened(io))) return false;
	io.write("s");
	return closed(io);
}

export async function driveModelPicker(
	io: ModelPickerIo,
	model: string,
): Promise<ModelPickerOutcome> {
	if (composerDraft(io.readLines({ omitFaint: true })) !== undefined) return "draft";
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
	let outcome: ModelPickerOutcome = "not-found";
	for (let step = 0; step < MAX_STEPS; step++) {
		if (highlightNamesModel(label, model)) {
			if (await acceptForSession(io)) return "switched";
			outcome = "no-session-key";
			break;
		}
		const before = label;
		io.write(label === ALL_MODELS ? "\r" : "\x1b[B");
		label = await settle(io, before);
	}
	for (let depth = 0; depth < 3 && pickerHighlight(io.readLines()) !== undefined; depth++) {
		io.write("\x1b");
		await io.delay(POLL_MS);
	}
	return outcome;
}
