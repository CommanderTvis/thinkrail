const ESC = "";

const MOUSE_MODES: ReadonlySet<number> = new Set([
	1000, // mouse: button events
	1002, // mouse: drag tracking
	1003, // mouse: any-motion tracking
	1006, // mouse: SGR coordinate encoding
	1007, // alternate scroll
]);

const ALT_BUFFER_MODES: ReadonlySet<number> = new Set([47, 1047, 1049]);

const MOUSE_RESET = [...MOUSE_MODES].map((mode) => `${ESC}[?${mode}l`).join("");

const PRIVATE_MODE_RE = new RegExp(`${ESC}\\[\\?([0-9;]+)([hl])`, "g");

const PARTIAL_MODE_RE = new RegExp(`${ESC}(?:\\[\\??[0-9;]{0,16})?$`);

export interface MouseModeGuard {
	transform(chunk: string): string;
	liveReplay(): string;
	/**
	 * Force a mouse-mode reset outside the byte stream (e.g. when process-tree polling detects the
	 * TUI that enabled it has exited). Returns "" when tracking was already off, so callers can push
	 * unconditionally without spamming a reset into every terminal on every poll tick.
	 */
	resetIfEnabled(): string;
}

/**
 * A TUI that crashes, is killed, or simply never pairs mouse tracking with the alt screen (Claude
 * Code's own CLI runs inline, no `?1049h`) can leave SGR mouse tracking (1000/1002/1003/1006)
 * enabled without its matching DECRST. xterm.js keeps honoring that mode client-side, so every
 * mouse move over what is now a bare shell prompt gets encoded as a report and sent to the shell,
 * which echoes the bytes as garbage. `transform` catches the alt-screen-paired case straight off
 * the byte stream; `resetIfEnabled` is the fallback for an inline TUI, driven by the caller
 * detecting (via process-tree polling) that the process which likely enabled it has exited. See
 * SPEC.md.
 */
export function createMouseModeGuard(): MouseModeGuard {
	const enabledModes = new Set<number>();
	let altMode: number | null = null;
	let carry = "";

	const applyModes = (params: string, enabled: boolean): string => {
		let inject = "";
		for (const raw of params.split(";")) {
			const mode = Number.parseInt(raw, 10);
			if (Number.isNaN(mode)) continue;
			if (ALT_BUFFER_MODES.has(mode)) {
				const leavingAlt = altMode !== null && !enabled;
				altMode = enabled ? mode : null;
				if (leavingAlt && enabledModes.size > 0) {
					inject += MOUSE_RESET;
					enabledModes.clear();
				}
			} else if (MOUSE_MODES.has(mode)) {
				if (enabled) enabledModes.add(mode);
				else enabledModes.delete(mode);
			}
		}
		return inject;
	};

	const consume = (text: string): string => {
		let result = "";
		let cursor = 0;
		PRIVATE_MODE_RE.lastIndex = 0;
		let match = PRIVATE_MODE_RE.exec(text);
		while (match !== null) {
			result += text.slice(cursor, match.index + match[0].length);
			result += applyModes(match[1] ?? "", match[2] === "h");
			cursor = match.index + match[0].length;
			match = PRIVATE_MODE_RE.exec(text);
		}
		result += text.slice(cursor);
		return result;
	};

	return {
		liveReplay() {
			if (altMode === null) return "";
			return `${ESC}[?${altMode}h${[...enabledModes].map((mode) => `${ESC}[?${mode}h`).join("")}`;
		},
		transform(chunk) {
			if (chunk === "") return chunk;
			const text = carry + chunk;
			carry = "";
			const partial = PARTIAL_MODE_RE.exec(text);
			if (partial && partial.index > 0) {
				carry = text.slice(partial.index);
				return consume(text.slice(0, partial.index));
			}
			if (partial && partial.index === 0) {
				carry = text;
				return "";
			}
			return consume(text);
		},
		resetIfEnabled() {
			if (enabledModes.size === 0 || altMode !== null) return "";
			enabledModes.clear();
			return MOUSE_RESET;
		},
	};
}
