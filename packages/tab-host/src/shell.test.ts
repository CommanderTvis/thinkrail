import { expect, test } from "bun:test";
import { createTabFs } from "./fs";
import { init } from "./git";
import { bashTool } from "./shell";

async function run(tool: ReturnType<typeof bashTool>, command: string): Promise<string> {
	const result = await tool.execute("call", { command }, undefined as never);
	return (result.content[0] as { text: string }).text;
}

test("bash runs coreutils and pipes over the tab volume", async () => {
	const fs = createTabFs();
	fs.mkdirSync("/projects/demo/src", { recursive: true });
	fs.writeFileSync("/projects/demo/src/a.ts", "export const a = 1;\nexport const b = 2;\n");
	const bash = bashTool(fs, "/projects/demo");

	expect(await run(bash, "ls src && grep -c export src/a.ts")).toBe("a.ts\n2");
	await run(bash, "echo hello | tr a-z A-Z > out.txt");
	expect(fs.readFileSync("/projects/demo/out.txt", "utf8")).toBe("HELLO\n");
	expect(await run(bash, "find . -name '*.ts' | sort")).toBe("./src/a.ts");
});

test("git in bash stages, commits and reports over isomorphic-git", async () => {
	const fs = createTabFs();
	fs.mkdirSync("/projects/repo", { recursive: true });
	await init(fs, "/projects/repo");
	const bash = bashTool(fs, "/projects/repo");

	await run(bash, "echo one > a.txt && git add -A && git commit -m 'first'");
	await run(bash, "echo two >> a.txt");
	expect(await run(bash, "git status -s")).toBe(" M a.txt");
	expect(await run(bash, "git diff")).toContain("+two");
	await run(bash, "git commit -a -m 'second'");
	expect(await run(bash, "git log --oneline | wc -l")).toBe("2");
});

test("a failing command reports its exit code as a tool error", async () => {
	const bash = bashTool(createTabFs(), "/");
	await expect(run(bash, "cat missing.txt")).rejects.toThrow("Command exited with code 1");
	await expect(run(bash, "git frobnicate")).rejects.toThrow("not a git repository");
});
