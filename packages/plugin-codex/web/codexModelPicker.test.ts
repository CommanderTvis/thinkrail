import { describe, expect, test } from "bun:test";
import {
	composerDraft,
	driveModelPicker,
	highlightNamesModel,
	type ModelPickerIo,
	pickerHighlight,
} from "./codexModelPicker";

interface Row {
	name: string;
	efforts: number;
}

const MODELS: Row[] = [
	{ name: "GPT-6-Astra (default)", efforts: 3 },
	{ name: "GPT-5.6 Sol", efforts: 3 },
	{ name: "GPT-5.6 Terra", efforts: 1 },
	{ name: "GPT-5.6 Luna (current)", efforts: 3 },
];

/** Codex's `/model` flow as its TUI draws it: numbered `›` rows, an effort list, `s` for this session. */
function fakeCodex(options: { quick?: boolean; draft?: string; sessionKey?: boolean } = {}) {
	let view: "composer" | "quick" | "models" | "effort" = "composer";
	let highlighted = 3;
	let typed = options.draft ?? "";
	const written: string[] = [];
	let outcome: string | undefined;

	const rows = (names: string[]) =>
		names.map((name, i) => `${i === highlighted ? "›" : " "} ${i + 1}. ${name}  A description`);
	const screen = (): string[] => {
		if (view === "quick") return ["  Select Model", ...rows(["codex-auto-fast", "All models"])];
		if (view === "models")
			return ["  Select Model and Effort", ...rows(MODELS.map((m) => m.name)), "  esc back"];
		if (view === "effort")
			return ["  Select Reasoning Level for x", ...rows(["Low", "Medium (default)", "High"])];
		return [...(outcome ? [`• ${outcome}`] : []), `› ${typed || "Ask Codex to do anything"}`];
	};

	const io: ModelPickerIo = {
		write(data) {
			written.push(data);
			if (view === "composer") {
				if (data === "\r" && typed === "/model") {
					view = options.quick ? "quick" : "models";
					highlighted = options.quick ? 0 : 3;
				} else if (data !== "\r") typed += data;
				return;
			}
			const size = view === "quick" ? 2 : view === "effort" ? 3 : MODELS.length;
			if (data === "\x1b[B") highlighted = (highlighted + 1) % size;
			else if (data === "\x1b") view = view === "models" && options.quick ? "quick" : "composer";
			else if (data === "\r" && view === "quick" && highlighted === 1) {
				view = "models";
				highlighted = 3;
			} else if (data === "\r" && view === "models") {
				if ((MODELS[highlighted]?.efforts ?? 0) > 1) {
					outcome = MODELS[highlighted]?.name;
					view = "effort";
					highlighted = 1;
				} else {
					outcome = "saved as default";
					view = "composer";
				}
			} else if (data === "s" && options.sessionKey === false) {
			} else if (data === "s" && view === "models" && MODELS[highlighted]?.efforts === 1) {
				outcome = `Model changed to ${MODELS[highlighted]?.name} for this session only`;
				view = "composer";
			} else if (data === "s" && view === "effort") {
				outcome = `Model changed to ${outcome} effort ${highlighted} for this session only`;
				view = "composer";
			}
			if (view === "composer") typed = "";
		},
		readLines: screen,
		delay: async () => {},
	};
	return { io, written, outcome: () => outcome };
}

describe("pickerHighlight", () => {
	test("reads the › row's display name without its marker or description", () => {
		expect(
			pickerHighlight(["  1. GPT-6-Astra (default)  x", "› 2. GPT-5.6 Luna (current)  x"]),
		).toBe("GPT-5.6 Luna");
		expect(pickerHighlight(["› 1. All models"])).toBe("All models");
	});

	test("finds nothing at the composer", () => {
		expect(pickerHighlight(["› Ask Codex to do anything", "› 1 thing"])).toBeUndefined();
	});
});

describe("composerDraft", () => {
	test("sees typed text, not the placeholder", () => {
		expect(composerDraft(["› Ask Codex to do anything"])).toBeUndefined();
		expect(composerDraft(["› Ask a follow-up question"])).toBeUndefined();
		expect(composerDraft(["› fix the build"])).toBe("fix the build");
	});
});

test("a display name names its slug", () => {
	expect(highlightNamesModel("GPT-5.6 Luna", "gpt-5.6-luna")).toBe(true);
	expect(highlightNamesModel("GPT-6-Astra", "gpt-6-astra")).toBe(true);
	expect(highlightNamesModel("GPT-5.6 Sol", "gpt-5.6-luna")).toBe(false);
});

describe("driveModelPicker", () => {
	test("a model with efforts is taken at its highlighted effort, for this session", async () => {
		const codex = fakeCodex();
		expect(await driveModelPicker(codex.io, "gpt-5.6-sol")).toBe("switched");
		expect(codex.outcome()).toBe("Model changed to GPT-5.6 Sol effort 1 for this session only");
	});

	test("a single-effort model takes the session key on its own row", async () => {
		const codex = fakeCodex();
		expect(await driveModelPicker(codex.io, "gpt-5.6-terra")).toBe("switched");
		expect(codex.outcome()).toBe("Model changed to GPT-5.6 Terra for this session only");
	});

	test("never presses Enter on a single-effort row, which saves the default", async () => {
		const codex = fakeCodex();
		await driveModelPicker(codex.io, "gpt-5.6-terra");
		expect(codex.outcome()).not.toBe("saved as default");
	});

	test("goes through All models when Codex opens its quick picker first", async () => {
		const codex = fakeCodex({ quick: true });
		expect(await driveModelPicker(codex.io, "gpt-6-astra")).toBe("switched");
		expect(codex.outcome()).toContain("GPT-6-Astra");
	});

	test("backs out of the picker when the model is not offered", async () => {
		const codex = fakeCodex({ quick: true });
		expect(await driveModelPicker(codex.io, "gpt-9")).toBe("not-found");
		expect(pickerHighlight(codex.io.readLines())).toBeUndefined();
	});

	test("a Codex without the session key is reported as such, not saved as the default", async () => {
		const codex = fakeCodex({ sessionKey: false });
		expect(await driveModelPicker(codex.io, "gpt-5.6-sol")).toBe("no-session-key");
		expect(codex.outcome()).toBe("GPT-5.6 Sol");
		expect(pickerHighlight(codex.io.readLines())).toBeUndefined();
	});

	test("leaves a draft alone", async () => {
		const codex = fakeCodex({ draft: "half a thought" });
		expect(await driveModelPicker(codex.io, "gpt-5.6-sol")).toBe("draft");
		expect(codex.written).toEqual([]);
	});
});
