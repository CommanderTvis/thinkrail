const MODELS = [
	{ name: "GPT-6-Astra (default)", slug: "gpt-6-astra", efforts: true },
	{ name: "GPT-5.6 Sol", slug: "gpt-5.6-sol", efforts: true },
	{ name: "GPT-5.6 Terra", slug: "gpt-5.6-terra", efforts: false },
	{ name: "GPT-5.6 Luna (current)", slug: "gpt-5.6-luna", efforts: true },
];
const EFFORTS = ["Low", "Medium (default)", "High"];

let view: "composer" | "models" | "effort" = "composer";
let highlighted = 3;
let model = 3;
let typed = "";

function rows(names: readonly string[]): string {
	return names
		.map((name, i) => `${i === highlighted ? "›" : " "} ${i + 1}. ${name}  A description`)
		.join("\r\n");
}

function render(): void {
	const body =
		view === "models"
			? `  Select Model and Effort\r\n\r\n${rows(MODELS.map((m) => m.name))}`
			: `  Select Reasoning Level for ${MODELS[model]?.name}\r\n\r\n${rows(EFFORTS)}`;
	process.stdout.write(
		`\x1b[?1049h\x1b[2J\x1b[H${body}\r\n\r\n  enter default · s session · esc back`,
	);
}

function leave(message: string): void {
	process.stdout.write(`\x1b[?1049l\r\n• ${message}\r\n`);
	process.exit(0);
}

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on("data", (chunk: Buffer) => {
	const data = chunk.toString();
	if (view === "composer") {
		typed += data;
		if (typed.includes("/model") && typed.includes("\r")) {
			view = "models";
			render();
			return;
		}
		process.stdout.write(`\r\x1b[2K› ${typed}`);
		return;
	}
	const size = view === "models" ? MODELS.length : EFFORTS.length;
	if (data.includes("\x1b[B")) highlighted = (highlighted + 1) % size;
	else if (data.includes("\x1b[A")) highlighted = (highlighted + size - 1) % size;
	else if (data === "\x1b") leave("Kept model");
	else if (view === "models" && data === "\r") {
		if (!MODELS[highlighted]?.efforts) leave("Saved the default model");
		model = highlighted;
		view = "effort";
		highlighted = 1;
	} else if (view === "models" && data === "s" && !MODELS[highlighted]?.efforts)
		leave(`Model changed to ${MODELS[highlighted]?.slug} for this session only`);
	else if (view === "effort" && data === "s")
		leave(
			`Model changed to ${MODELS[model]?.slug} ${EFFORTS[highlighted]?.split(" ")[0]?.toLowerCase()} for this session only`,
		);
	else if (view === "effort" && data === "\r") leave("Saved the default model");
	render();
});

process.stdout.write("fake-codex ready\r\n› Ask Codex to do anything");
