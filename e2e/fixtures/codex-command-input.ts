import { env, exit, stdin, stdout } from "node:process";

let typed = "";
let lastCharacterAt = Number.NEGATIVE_INFINITY;
let submitted = 0;

stdin.setRawMode(true);
stdin.resume();
stdin.on("data", (chunk: Buffer) => {
	for (const character of chunk.toString()) {
		if (character === "\x03") exit(0);
		if (character === "\r" && performance.now() - lastCharacterAt >= 100) {
			submitted++;
			stdout.write(`\r\nSUBMITTED ${submitted}: ${JSON.stringify(typed)}\r\n`);
			typed = "";
		} else {
			typed += character === "\r" ? "\n" : character;
			lastCharacterAt = performance.now();
		}
	}
});

stdout.write("codex command input ready\r\n");
await fetch(env.THINKRAIL_CODEX_STATUS_URL ?? "", {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ hook_event_name: "SessionStart", session_id: "codex-ide-command-test" }),
});
