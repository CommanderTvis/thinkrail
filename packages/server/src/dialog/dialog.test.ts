import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noPickerMessage, pickerFailure, pickersFor, selectDirectory, selectFile } from "./dialog";

test("macOS picker uses osascript 'choose folder'", () => {
	const pickers = pickersFor("darwin", "directory");
	expect(pickers).toHaveLength(1);
	expect(pickers[0]?.cmd[0]).toBe("osascript");
	expect(pickers[0]?.cmd.join(" ")).toContain("choose folder");
});

test("Linux picker tries zenity then kdialog, both as directory pickers", () => {
	const pickers = pickersFor("linux", "directory");
	expect(pickers.map((p) => p.cmd[0])).toEqual(["zenity", "kdialog"]);
	expect(pickers[0]?.cmd).toContain("--directory");
	expect(pickers[1]?.cmd).toContain("--getexistingdirectory");
});

test("Windows picker: a PowerShell FolderBrowserDialog, -Sta, owned by a top-most form", () => {
	const pickers = pickersFor("win32", "directory");
	expect(pickers.map((p) => p.cmd[0])).toEqual(["powershell.exe", "pwsh.exe"]);
	for (const picker of pickers) {
		expect(picker.cmd).toContain("-Sta");
		const flag = picker.cmd.indexOf("-EncodedCommand");
		expect(flag).toBeGreaterThan(-1);
		const script = Buffer.from(picker.cmd[flag + 1] ?? "", "base64").toString("utf16le");
		expect(script).toContain("FolderBrowserDialog");
		expect(script).toContain("$owner.TopMost = $true");
		expect(script).toContain("$d.ShowDialog($owner)");
		expect(script).toContain("AttachThreadInput");
		expect(script).toContain("SetForegroundWindow($owner.Handle)");
		expect(script).toContain("AttachThreadInput($me, $fg, $true)");
		expect(script).toContain("AttachThreadInput($me, $fg, $false)");
		expect(script).toContain("} catch { }");
	}
});

test("pickers distinguish cancellation from a failed non-zero exit", () => {
	const execution = { stdout: "", stderr: "", code: 1 };
	expect(
		pickersFor("darwin", "directory")[0]?.isCancellation({
			...execution,
			stderr: "execution error: User canceled. (-128)",
		}),
	).toBe(true);
	expect(pickersFor("darwin", "directory")[0]?.isCancellation(execution)).toBe(false);
	for (const kind of ["directory", "file"] as const) {
		for (const picker of pickersFor("linux", kind)) {
			expect(picker.isCancellation(execution)).toBe(true);
			expect(picker.isCancellation({ ...execution, stderr: "Failed to open display" })).toBe(false);
		}
		for (const picker of pickersFor("win32", kind)) {
			expect(picker.isCancellation(execution)).toBe(false);
		}
	}
});

test("unknown platform has no native picker", () => {
	expect(pickersFor("sunos" as NodeJS.Platform, "directory")).toEqual([]);
	expect(pickersFor("sunos" as NodeJS.Platform, "file")).toEqual([]);
});

test("a failed picker names a cause — never an empty message, never a stray CR", () => {
	expect(pickerFailure("directory", "Add-Type : Cannot load assembly\r\n  At line:1\r\n", 1)).toBe(
		"The folder picker failed: Add-Type : Cannot load assembly",
	);
	expect(pickerFailure("directory", "", 137)).toBe("The folder picker failed: exit 137");
	expect(pickerFailure("directory", "   \r\n \n", 1)).toBe("The folder picker failed: exit 1");
	expect(pickerFailure("file", "", 1)).toBe("The file picker failed: exit 1");
});

test("no runnable picker points at the fix on Linux, names the platform elsewhere", () => {
	expect(noPickerMessage("linux", "directory")).toContain("install zenity or kdialog");
	expect(noPickerMessage("sunos" as NodeJS.Platform, "directory")).toContain("(sunos)");
	expect(noPickerMessage("sunos" as NodeJS.Platform, "file")).toContain("No native file picker");
});

test("headless Linux fails before spawning a graphical picker", async () => {
	let spawned = false;
	await expect(
		selectDirectory({
			platform: "linux",
			env: {},
			runPicker: async () => {
				spawned = true;
				return { stdout: "", stderr: "", code: 0 };
			},
		}),
	).rejects.toThrow("No graphical session");
	expect(spawned).toBe(false);
});

test("a genuine Linux cancel returns null and does not open the fallback picker", async () => {
	const commands: string[] = [];
	const result = await selectDirectory({
		platform: "linux",
		env: { DISPLAY: ":1" },
		runPicker: async ([command]) => {
			commands.push(command ?? "");
			return { stdout: "", stderr: "", code: 1 };
		},
	});
	expect(result).toEqual({ path: null });
	expect(commands).toEqual(["zenity"]);
});

test("a failed Linux picker falls through to the next candidate", async () => {
	const commands: string[] = [];
	const result = await selectDirectory({
		platform: "linux",
		env: { DISPLAY: ":1" },
		runPicker: async ([command]) => {
			commands.push(command ?? "");
			return command === "zenity"
				? { stdout: "", stderr: "Gtk-WARNING: Failed to open display", code: 1 }
				: { stdout: "/repos/fallback\n", stderr: "", code: 0 };
		},
	});
	expect(result).toEqual({ path: "/repos/fallback" });
	expect(commands).toEqual(["zenity", "kdialog"]);
});

test("picker exhaustion throws a diagnostic instead of cancellation", async () => {
	await expect(
		selectDirectory({
			platform: "linux",
			env: { WAYLAND_DISPLAY: "wayland-0" },
			runPicker: async ([command]) => ({
				stdout: "",
				stderr: command === "zenity" ? "Gtk-WARNING: Failed to open display" : "",
				code: command === "zenity" ? 1 : 254,
			}),
		}),
	).rejects.toThrow("Failed to open display");
});

test("picker output is trimmed, trailing separators dropped, empty → null", () => {
	const parse = pickersFor("darwin", "directory")[0]?.parse;
	if (!parse) throw new Error("expected a darwin picker");
	expect(parse("/Users/me/project/\n")).toBe("/Users/me/project");
	expect(parse("C:\\Users\\me\\project\\")).toBe("C:\\Users\\me\\project");
	expect(parse("   ")).toBeNull();
	expect(parse("")).toBeNull();
});

test("THINKRAIL_PICK_DIR overrides the native picker", async () => {
	const saved = process.env.THINKRAIL_PICK_DIR;
	process.env.THINKRAIL_PICK_DIR = "/tmp/forced/repo";
	try {
		expect(await selectDirectory()).toEqual({ path: "/tmp/forced/repo" });
	} finally {
		if (saved === undefined) delete process.env.THINKRAIL_PICK_DIR;
		else process.env.THINKRAIL_PICK_DIR = saved;
	}
});

test("a picker override file can force a deterministic failure before native selection", async () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-pick-"));
	const pointer = join(dir, "pick-dir");
	writeFileSync(pointer, "error:Deterministic picker failure");
	let spawned = false;
	try {
		await expect(
			selectDirectory({
				platform: "win32",
				env: { THINKRAIL_PICK_DIR: pointer },
				runPicker: async () => {
					spawned = true;
					return { stdout: "", stderr: "", code: 0 };
				},
			}),
		).rejects.toThrow("Deterministic picker failure");
		expect(spawned).toBe(false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("THINKRAIL_PICK_DIR reads its value from a file when it names one (live per call)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-pick-"));
	const pointer = join(dir, "pick-dir");
	const saved = process.env.THINKRAIL_PICK_DIR;
	process.env.THINKRAIL_PICK_DIR = pointer;
	try {
		writeFileSync(pointer, "/repos/alpha\n");
		expect(await selectDirectory()).toEqual({ path: "/repos/alpha" });
		writeFileSync(pointer, "/repos/beta");
		expect(await selectDirectory()).toEqual({ path: "/repos/beta" });
	} finally {
		if (saved === undefined) delete process.env.THINKRAIL_PICK_DIR;
		else process.env.THINKRAIL_PICK_DIR = saved;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the file picker asks each OS for a file, and macOS for hidden ones too", () => {
	expect(pickersFor("darwin", "file")[0]?.cmd.join(" ")).toContain(
		'choose file with prompt "Choose a file" invisibles true',
	);

	const linux = pickersFor("linux", "file");
	expect(linux[0]?.cmd).toContain("--file-selection");
	expect(linux[0]?.cmd).not.toContain("--directory");
	expect(linux[1]?.cmd).toContain("--getopenfilename");

	for (const picker of pickersFor("win32", "file")) {
		const flag = picker.cmd.indexOf("-EncodedCommand");
		const script = Buffer.from(picker.cmd[flag + 1] ?? "", "base64").toString("utf16le");
		expect(script).toContain("OpenFileDialog");
		expect(script).toContain("Write-Output $d.FileName");
		expect(script).not.toContain("FolderBrowserDialog");
	}
});

test("each picker reads its own override, so one never answers for the other", async () => {
	const savedDir = process.env.THINKRAIL_PICK_DIR;
	const savedFile = process.env.THINKRAIL_PICK_FILE;
	process.env.THINKRAIL_PICK_DIR = "/tmp/forced/repo";
	process.env.THINKRAIL_PICK_FILE = "/opt/tools/claude";
	try {
		expect(await selectFile()).toEqual({ path: "/opt/tools/claude" });
		expect(await selectDirectory()).toEqual({ path: "/tmp/forced/repo" });
	} finally {
		if (savedDir === undefined) delete process.env.THINKRAIL_PICK_DIR;
		else process.env.THINKRAIL_PICK_DIR = savedDir;
		if (savedFile === undefined) delete process.env.THINKRAIL_PICK_FILE;
		else process.env.THINKRAIL_PICK_FILE = savedFile;
	}
});
