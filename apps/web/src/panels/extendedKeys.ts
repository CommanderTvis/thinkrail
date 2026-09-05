export type ExtendedKeyMode = "off" | "kitty" | "modify-other-keys";

export interface ExtendedKeyState {
	/** `CSI > flags u` — the kitty keyboard protocol, pushed and popped as a stack. */
	pushKitty(flags: number): void;
	popKitty(): void;
	/** `CSI > 4 ; level m` — xterm's modifyOtherKeys. */
	setModifyOtherKeys(level: number): void;
	mode(): ExtendedKeyMode;
	/** The bytes for a key press, or null to let xterm encode it as it normally would. */
	encode(
		event: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">,
		options?: { agentNewline?: boolean },
	): string | null;
}

/** Only the keys a bare terminal cannot distinguish, by their CSI-u codepoint. */
const AMBIGUOUS_KEYS: Record<string, number> = { Enter: 13, Tab: 9, Backspace: 127 };

function modifierCode(event: Pick<KeyboardEvent, "shiftKey" | "ctrlKey" | "altKey">): number {
	// CSI-u encodes modifiers as a 1-based bitmask: shift 1, alt 2, ctrl 4.
	return 1 + (event.shiftKey ? 1 : 0) + (event.altKey ? 2 : 0) + (event.ctrlKey ? 4 : 0);
}

/**
 * Track whether the program in the terminal asked to tell modified keys apart, and encode them only then.
 *
 * Shift+Enter and Enter are the same byte in a plain terminal, so a TUI cannot offer "newline" separately
 * from "submit" — but sending something distinct unconditionally is worse than doing nothing: outside an
 * app that asked for it, an ESC-prefixed Enter is a readline meta sequence and does something unrelated.
 * A terminal answers this by negotiating, so this mirrors the two requests real terminals implement and
 * stays silent until one arrives. See panels/SPEC.md.
 */
export function createExtendedKeyState(): ExtendedKeyState {
	const kittyStack: number[] = [];
	let modifyOtherKeys = 0;

	const mode = (): ExtendedKeyMode => {
		if ((kittyStack[kittyStack.length - 1] ?? 0) > 0) return "kitty";
		return modifyOtherKeys > 0 ? "modify-other-keys" : "off";
	};

	return {
		pushKitty(flags) {
			kittyStack.push(Number.isFinite(flags) ? flags : 0);
		},
		popKitty() {
			kittyStack.pop();
		},
		setModifyOtherKeys(level) {
			modifyOtherKeys = Number.isFinite(level) ? level : 0;
		},
		mode,
		encode(event, options) {
			const code = AMBIGUOUS_KEYS[event.key];
			if (code === undefined || event.metaKey) return null;
			const modifiers = modifierCode(event);
			// An unmodified key still means what it always meant; only report what xterm cannot express.
			if (modifiers === 1) return null;
			const active = mode();
			if (active === "kitty") return `\u001b[${code};${modifiers}u`;
			if (active === "modify-other-keys") return `\u001b[27;${modifiers};${code}~`;
			// Nothing negotiated. An agent CLI that asks for no protocol reads ESC+CR as a newline — the
			// convention `claude /terminal-setup` installs into iTerm2 and VS Code — so a terminal known to
			// be running one sends exactly that for Shift+Enter. See panels/SPEC.md.
			if (options?.agentNewline && event.key === "Enter" && modifiers === 2) return "\u001b\r";
			return null;
		},
	};
}
