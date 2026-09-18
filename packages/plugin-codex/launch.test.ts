import { expect, test } from "bun:test";
import { CODEX_PROMPT_JSON_ENV, codexLaunchLine, hasThinkrailPrompt } from "./launch";

function launch(extra?: string, appendSystemPrompt = true) {
	const instructions = "ThinkRail instructions\nQuotes \" and apostrophes ' and $HOME and `date`\n";
	const command = `${process.execPath} -e 'console.log(JSON.stringify({args:process.argv.slice(1),url:process.env.THINKRAIL_CODEX_STATUS_URL}))' --`;
	const line = codexLaunchLine(command, {
		appendSystemPrompt,
		systemPrompt: extra,
		mcp: false,
		windows: false,
	});
	const run = Bun.spawnSync(["/bin/sh", "-c", line], {
		env: {
			...process.env,
			[CODEX_PROMPT_JSON_ENV]: JSON.stringify(instructions),
			THINKRAIL_CODEX_STATUS_URL: "http://localhost/status/token",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(run.exitCode).toBe(0);
	const result = JSON.parse(run.stdout.toString());
	expect(result.args[0]).toBe("-c");
	expect(result.args).toHaveLength(2);
	return {
		value: Bun.TOML.parse(result.args[1]).developer_instructions,
		instructions,
		url: result.url,
		line,
	};
}

test("the shell passes the host-encoded instructions as one TOML string without evaluating their contents", () => {
	const result = launch();
	expect(result.value).toBe(result.instructions);
	expect(result.url).toBe("http://localhost/status/token?thinkrail_prompt=1");
	expect(hasThinkrailPrompt(result.line)).toBe(true);
});

test("extra instructions join the same override and preserve quotes, newlines, and shell syntax", () => {
	const extra = "Be brief.\n\"quotes\" 'apostrophe' \\path $HOME $(exit 91) `exit 92` ✨";
	const result = launch(extra);
	expect(result.value).toBe(`${result.instructions}\n\n${extra}`);
});

test("disabled integration keeps launcher instructions and the untagged hook URL", () => {
	const result = launch("Be brief", false);
	expect(result.value).toBe("Be brief");
	expect(result.url).toBe("http://localhost/status/token");
	expect(hasThinkrailPrompt(result.line)).toBe(false);
});
