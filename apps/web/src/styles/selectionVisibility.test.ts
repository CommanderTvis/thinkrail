import { describe, expect, it } from "bun:test";
import dark from "../themes/bundled/dark.theme.json";
import hcDark from "../themes/bundled/high-contrast-dark.theme.json";
import hcLight from "../themes/bundled/high-contrast-light.theme.json";
import light from "../themes/bundled/light.theme.json";
import colors from "./colors.json";

const THEMES = [dark, light, hcDark, hcLight];

/** The floor a wash has to clear to read as a selection rather than as a rendering artefact. */
const MIN_EFFECTIVE_ALPHA = 0.12;

function paletteAlpha(hex: string): number {
	const digits = hex.replace("#", "");
	return digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1;
}

function mutedStep(): number {
	const step = colors.scale.muted;
	if (typeof step !== "number") throw new Error("the muted alpha step is missing");
	return step / 100;
}

describe("the selection a theme paints", () => {
	it("survives the muted alpha step the content canvas applies", () => {
		for (const theme of THEMES) {
			const effective = paletteAlpha(theme.colors.selection) * mutedStep();
			expect({ theme: theme.id, clears: effective >= MIN_EFFECTIVE_ALPHA }).toEqual({
				theme: theme.id,
				clears: true,
			});
		}
	});

	it("leaves a theme with no selection foreground translucent enough to read through", () => {
		for (const theme of THEMES) {
			if (theme.colors.selectionForeground !== null) continue;
			expect({ theme: theme.id, opaque: paletteAlpha(theme.colors.selection) === 1 }).toEqual({
				theme: theme.id,
				opaque: false,
			});
		}
	});
});
