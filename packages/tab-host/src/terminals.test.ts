import { expect, test } from "bun:test";
import { createTabFs } from "./fs";
import { createShell } from "./shell";
import { TabTerminals } from "./terminals";

function harness() {
	const fs = createTabFs();
	fs.mkdirSync("/projects/demo/sub", { recursive: true });
	const pushes: { channel: string; data: unknown }[] = [];
	let ran = 0;
	const terminals = new TabTerminals({
		publish: (channel, data) => pushes.push({ channel, data }),
		shell: () => ({
			bash: createShell(fs, "/projects/demo"),
			root: "/projects/demo",
			name: "demo",
		}),
		commandRan: () => ran++,
	});
	const output = (id: string) =>
		pushes
			.filter((push) => push.channel === "terminal.data")
			.map((push) => push.data as { id: string; data: string })
			.filter((push) => push.id === id)
			.map((push) => push.data)
			.join("");
	const settle = async () => {
		for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 5));
	};
	return { fs, terminals, pushes, output, settle, ran: () => ran };
}

test("a terminal echoes typing, runs the line, and keeps cd between commands", async () => {
	const { terminals, output, settle, ran } = harness();
	terminals.reserve("ws_demo", "t1", "Terminal");
	const { id, created } = terminals.attach("ws_demo", "t1");
	expect(created).toBe(true);
	expect(output(id)).toContain("demo\x1b[0m:\x1b[34m~\x1b[0m$ ");

	terminals.write(id, "cd sub\r");
	await settle();
	terminals.write(id, "pwd\r");
	await settle();
	expect(output(id)).toContain("/projects/demo/sub\r\n");
	expect(output(id)).toContain(":\x1b[34m~/sub\x1b[0m$ ");
	expect(ran()).toBe(2);
});

test("history recalls the last line, Ctrl+C drops the line, and reattach replays the screen", async () => {
	const { terminals, output, settle } = harness();
	const { id } = terminals.attach("ws_demo", "t1", "Terminal");
	terminals.write(id, "echo one\r");
	await settle();
	terminals.write(id, "\x1b[A");
	expect(output(id).endsWith("echo one")).toBe(true);
	terminals.write(id, "\x03");
	expect(output(id)).toContain("^C\r\n");

	const again = terminals.attach("ws_demo", "t1");
	expect(again).toEqual({ id, created: false, replay: output(id) });
	expect(terminals.list("ws_demo")).toEqual([{ tabKey: "t1", title: "Terminal" }]);
	expect(terminals.close("ws_demo", "t1")).toEqual({ closed: true, busy: false });
	expect(terminals.list("ws_demo")).toEqual([]);
});
