const ROWS = [
	"Default (recommended)   Opus 5 with 1M context · Best for everyday, complex tasks",
	"Opus (1M context)       Opus 5 with 1M context · Best for everyday, complex tasks",
	"Fable                   Fable 5 · Most capable for your hardest tasks",
	"Sonnet                  Sonnet 5 · Efficient for routine tasks",
	"Haiku                   Haiku 4.5 · Fastest for quick answers",
	"Opus ✔                  Opus 5 · Best for everyday, complex tasks",
];
const CONFIRMED = ["Default", "Opus 5", "Fable 5", "Sonnet 5", "Haiku 4.5", "Opus 5"];

let pickerOpen = false;
let highlighted = ROWS.length - 1;
let typed = "";

function render(): void {
	const rows = ROWS.map((row, i) => `${i === highlighted ? "❯" : " "} ${i + 1}. ${row}`).join(
		"\r\n",
	);
	process.stdout.write(`\r\nSelect model\r\n${rows}\r\n`);
}

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on("data", (chunk: Buffer) => {
	const data = chunk.toString();
	if (!pickerOpen) {
		typed += data;
		if (typed.includes("/model") && typed.includes("\r")) {
			pickerOpen = true;
			render();
		}
		return;
	}
	if (data.includes("\x1b[B")) {
		highlighted = (highlighted + 1) % ROWS.length;
		render();
		return;
	}
	if (data.includes("\x1b[A")) {
		highlighted = (highlighted + ROWS.length - 1) % ROWS.length;
		render();
		return;
	}
	if (data.includes("s")) {
		process.stdout.write(`\r\nSet model to ${CONFIRMED[highlighted]} for this session only\r\n`);
		process.exit(0);
	}
	if (data.includes("\x1b")) {
		process.stdout.write("\r\nKept model\r\n");
		process.exit(0);
	}
});

process.stdout.write("fake-model-picker ready\r\n");
