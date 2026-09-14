const LEVELS = ["low", "medium", "high", "xhigh", "max", "ultracode"];
const LABELS = `         ${LEVELS.join("    ")}`;

let sliderOpen = false;
let index = LEVELS.indexOf("high");
let typed = "";
let confirming = false;

function render(): void {
	const level = LEVELS[index] as string;
	const at = LABELS.indexOf(level, index === 2 ? LABELS.indexOf("medium") : 0);
	const center = Math.floor(at + level.length / 2);
	const track = `${"─".repeat(center)}▲${"─".repeat(20)}`;
	process.stdout.write(
		`\r\n    Faster                                            Smarter\r\n${track}\r\n${LABELS}\r\n ←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel\r\n`,
	);
}

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on("data", (chunk: Buffer) => {
	const data = chunk.toString();
	if (!sliderOpen) {
		typed += data;
		if (typed.includes("/effort") && typed.includes("\r")) {
			sliderOpen = true;
			render();
		}
		return;
	}
	if (confirming) {
		if (data.includes("\r")) {
			process.stdout.write(`\r\nSet effort to ${LEVELS[index]} for this session only\r\n`);
			process.exit(0);
		}
		return;
	}
	if (data.includes("\x1b[C")) {
		index = Math.min(LEVELS.length - 1, index + 1);
		render();
		return;
	}
	if (data.includes("\x1b[D")) {
		index = Math.max(0, index - 1);
		render();
		return;
	}
	if (data.includes("s")) {
		// The real picker asks before switching a cached conversation, and waits for an answer.
		confirming = true;
		process.stdout.write(
			`\r\n    Change effort level?\r\n\r\n  ❯ 1. Yes, switch to ${LEVELS[index]}\r\n    2. No, go back\r\n`,
		);
		return;
	}
	if (data.includes("\x1b")) {
		process.stdout.write("\r\nKept effort\r\n");
		process.exit(0);
	}
});

process.stdout.write("fake-effort-slider ready\r\n");
