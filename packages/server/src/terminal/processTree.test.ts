import { describe, expect, test } from "bun:test";
import { findDescendant, type ProcessRow, parseProcessRows, snapshotFromRows } from "./processTree";

describe("parseProcessRows", () => {
	test("parses the `ps -Ao pid=,ppid=,comm=` shape, basenaming the command", () => {
		expect(
			parseProcessRows(
				["  54554     1 -zsh", "  54850 54554 claude", "  16264 54850 /bin/zsh", ""].join("\n"),
			),
		).toEqual([
			{ pid: 54554, ppid: 1, name: "-zsh" },
			{ pid: 54850, ppid: 54554, name: "claude" },
			{ pid: 16264, ppid: 54850, name: "zsh" },
		]);
	});

	test("keeps names containing spaces intact", () => {
		expect(parseProcessRows("  411   1 com.apple.cm anager")).toEqual([
			{ pid: 411, ppid: 1, name: "com.apple.cm anager" },
		]);
	});

	test("strips a .exe suffix so Windows rows compare like POSIX ones", () => {
		expect(parseProcessRows("4321 100 claude.exe")).toEqual([
			{ pid: 4321, ppid: 100, name: "claude" },
		]);
	});

	test("skips header junk and malformed lines rather than throwing", () => {
		expect(parseProcessRows(["PID PPID COMM", "not a row", "  7 3 bun"].join("\n"))).toEqual([
			{ pid: 7, ppid: 3, name: "bun" },
		]);
	});
});

describe("findDescendant", () => {
	const tree = (rows: ProcessRow[]) => snapshotFromRows(rows);

	test("finds a direct child — the common case of typing `claude` at the prompt", () => {
		const snapshot = tree([
			{ pid: 100, ppid: 1, name: "zsh" },
			{ pid: 200, ppid: 100, name: "claude" },
		]);
		expect(findDescendant(snapshot, 100, ["claude"])).toBe("claude");
	});

	test("finds a grandchild behind a wrapper script", () => {
		const snapshot = tree([
			{ pid: 100, ppid: 1, name: "zsh" },
			{ pid: 200, ppid: 100, name: "sh" },
			{ pid: 300, ppid: 200, name: "claude" },
		]);
		expect(findDescendant(snapshot, 100, ["claude"])).toBe("claude");
	});

	test("does not match the root itself — a shell is not its own agent", () => {
		const snapshot = tree([{ pid: 100, ppid: 1, name: "claude" }]);
		expect(findDescendant(snapshot, 100, ["claude"])).toBeNull();
	});

	test("ignores an unrelated tree", () => {
		const snapshot = tree([
			{ pid: 100, ppid: 1, name: "zsh" },
			{ pid: 200, ppid: 100, name: "vim" },
			{ pid: 900, ppid: 1, name: "claude" },
		]);
		expect(findDescendant(snapshot, 100, ["claude"])).toBeNull();
	});

	test("stops at the depth cap", () => {
		const snapshot = tree([
			{ pid: 1, ppid: 0, name: "zsh" },
			{ pid: 2, ppid: 1, name: "a" },
			{ pid: 3, ppid: 2, name: "b" },
			{ pid: 4, ppid: 3, name: "c" },
			{ pid: 5, ppid: 4, name: "claude" },
		]);
		expect(findDescendant(snapshot, 1, ["claude"], 4)).toBe("claude");
		expect(findDescendant(snapshot, 1, ["claude"], 3)).toBeNull();
	});

	test("terminates on a parent cycle instead of spinning", () => {
		const snapshot = tree([
			{ pid: 100, ppid: 200, name: "a" },
			{ pid: 200, ppid: 100, name: "b" },
		]);
		expect(findDescendant(snapshot, 100, ["claude"], 32)).toBeNull();
	});
});
