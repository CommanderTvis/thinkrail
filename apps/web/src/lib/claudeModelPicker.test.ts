import { describe, expect, test } from "bun:test";
import {
	confirmationChoice,
	driveModelPicker,
	highlightNamesModel,
	type ModelPickerIo,
	pickerHighlight,
} from "./claudeModelPicker";

const PICKER_ROWS = [
	"Default (recommended)   Opus 5 with 1M context · Best for everyday, complex tasks",
	"Opus (1M context)       Opus 5 with 1M context · Best for everyday, complex tasks",
	"Fable                   Fable 5 · Most capable for your hardest tasks",
	"Sonnet                  Sonnet 5 · Efficient for routine tasks",
	"Haiku                   Haiku 4.5 · Fastest for quick answers",
	"Opus ✔                  Opus 5 · Best for everyday, complex tasks",
];

function renderPicker(highlighted: number): string[] {
	return [
		"Select model",
		...PICKER_ROWS.map((row, i) => `${i === highlighted ? "❯" : " "} ${i + 1}. ${row}`),
		"Enter to set as default · s to use this session only · Esc to cancel",
	];
}

describe("pickerHighlight", () => {
	test("reads the ❯ row's label, dropping the description column and the ✔", () => {
		expect(pickerHighlight(renderPicker(5))).toBe("Opus");
		expect(pickerHighlight(renderPicker(1))).toBe("Opus (1M context)");
		expect(pickerHighlight(renderPicker(0))).toBe("Default (recommended)");
	});

	test("ignores the composer prompt and reads the newest render bottom-up", () => {
		const lines = ['❯ Try "fix lint errors"', ...renderPicker(5), ...renderPicker(3)];
		expect(pickerHighlight(lines)).toBe("Sonnet");
	});

	test("finds nothing in a plain shell transcript", () => {
		expect(pickerHighlight(["$ ls", "README.md", "❯ /model"])).toBeUndefined();
		expect(pickerHighlight([])).toBeUndefined();
	});
});

describe("highlightNamesModel", () => {
	test("matches the bare row and its parenthesised variant, never the Default row", () => {
		expect(highlightNamesModel("Opus", "opus")).toBe(true);
		expect(highlightNamesModel("Opus (1M context)", "opus")).toBe(true);
		expect(highlightNamesModel("Sonnet", "sonnet")).toBe(true);
		expect(highlightNamesModel("Default (recommended)", "opus")).toBe(false);
		expect(highlightNamesModel("Haiku", "sonnet")).toBe(false);
		expect(highlightNamesModel(undefined, "opus")).toBe(false);
	});
});

const CONFIRM = [
	"Switch model?",
	"Your next response will be slower and use more tokens",
	"❯ 1. Yes, switch to Opus 5 (1M context) (default)",
	"  2. No, go back",
];

describe("confirmationChoice", () => {
	test("reads which answer the confirmation is sitting on", () => {
		expect(confirmationChoice(CONFIRM)).toBe("yes");
		expect(
			confirmationChoice([
				"Switch model?",
				"  1. Yes, switch to Opus 5 (1M context) (default)",
				"❯ 2. No, go back",
			]),
		).toBe("no");
	});

	test("an ordinary picker is not a confirmation", () => {
		expect(confirmationChoice(renderPicker(3))).toBeNull();
		expect(confirmationChoice(["Switch model?"])).toBeNull();
	});
});

interface FakePicker {
	io: ModelPickerIo;
	writes: string[];
}

function fakePicker(initialHighlight: number): FakePicker {
	const writes: string[] = [];
	let open = false;
	let confirming = false;
	let highlighted = initialHighlight;
	return {
		writes,
		io: {
			write: (data) => {
				writes.push(data);
				if (data === "\r" && !open && !confirming) {
					open = true;
					return;
				}
				if (confirming && data === "\r") {
					confirming = false;
					open = false;
					return;
				}
				if (open && data === "\x1b[B") highlighted = (highlighted + 1) % PICKER_ROWS.length;
				if (open && data === "s") confirming = true;
			},
			readLines: () => (confirming ? CONFIRM : open ? renderPicker(highlighted) : ["❯ /model"]),
			delay: () => Promise.resolve(),
		},
	};
}

describe("driveModelPicker", () => {
	test("clears the draft, arrows to the target, presses s — never a digit — and puts the draft back", async () => {
		const picker = fakePicker(5);
		await expect(driveModelPicker(picker.io, "sonnet")).resolves.toBe("switched");
		expect(picker.writes).toEqual([
			"\u0015",
			"/model",
			"\r",
			"\x1b[B",
			"\x1b[B",
			"\x1b[B",
			"\x1b[B",
			"s",
			"\r",
			"\u0019",
		]);
	});

	test("presses s straight away when the current model is the target", async () => {
		const picker = fakePicker(5);
		await expect(driveModelPicker(picker.io, "opus")).resolves.toBe("switched");
		// The cached-conversation confirmation is answered rather than left on screen.
		expect(picker.writes).toEqual(["\u0015", "/model", "\r", "s", "\r", "\u0019"]);
	});

	test("a half-typed prompt is not lost by any exit — every path yanks it back", async () => {
		const missing = fakePicker(5);
		await expect(driveModelPicker(missing.io, "unknown")).resolves.toBe("not-found");
		expect(missing.writes.at(-1)).toBe("\u0019");

		const writes: string[] = [];
		const io: ModelPickerIo = {
			write: (data) => writes.push(data),
			readLines: () => ["$ /model", "zsh: no such file or directory"],
			delay: () => Promise.resolve(),
		};
		await expect(driveModelPicker(io, "sonnet")).resolves.toBe("no-picker");
		expect(writes.at(-1)).toBe("\u0019");
	});

	test("escapes out when no row ever names the target", async () => {
		const picker = fakePicker(5);
		await expect(driveModelPicker(picker.io, "unknown")).resolves.toBe("not-found");
		expect(picker.writes.at(-2)).toBe("\x1b");
		expect(picker.writes.at(-1)).toBe("\u0019");
		expect(picker.writes).not.toContain("s");
	});

	test("gives up with Esc when nothing ever renders a picker", async () => {
		const writes: string[] = [];
		const io: ModelPickerIo = {
			write: (data) => writes.push(data),
			readLines: () => ["$ /model", "zsh: no such file or directory"],
			delay: () => Promise.resolve(),
		};
		await expect(driveModelPicker(io, "sonnet")).resolves.toBe("no-picker");
		expect(writes).toEqual(["\u0015", "/model", "\r", "\x1b", "\u0019"]);
	});
});
