import { readFileSync, statSync } from "node:fs";

export interface Picker {
	cmd: string[];
	parse: (stdout: string) => string | null;
	nonZeroExit: "cancel" | "error";
}

const toPath = (stdout: string): string | null => stdout.trim().replace(/[/\\]+$/, "") || null;

const WINDOWS_PICKER = [
	"$ErrorActionPreference = 'Stop'",
	"Add-Type -AssemblyName System.Windows.Forms",
	"$owner = New-Object System.Windows.Forms.Form",
	"$owner.TopMost = $true",
	"$owner.ShowInTaskbar = $false",
	"$owner.Opacity = 0",
	"$owner.Show()",
	"try {",
	"  Add-Type -Namespace ThinkRail -Name Fg -MemberDefinition '",
	'    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
	'    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w, IntPtr p);',
	'    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool join);',
	'    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr w);',
	'    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();\'',
	"  $fg = [ThinkRail.Fg]::GetWindowThreadProcessId([ThinkRail.Fg]::GetForegroundWindow(), [IntPtr]::Zero)",
	"  $me = [ThinkRail.Fg]::GetCurrentThreadId()",
	"  [void][ThinkRail.Fg]::AttachThreadInput($me, $fg, $true)",
	"  [void][ThinkRail.Fg]::SetForegroundWindow($owner.Handle)",
	"  [void][ThinkRail.Fg]::AttachThreadInput($me, $fg, $false)",
	"} catch { }",
	"$d = New-Object System.Windows.Forms.FolderBrowserDialog",
	"$d.Description = 'Open project'",
	"$ok = $d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK",
	"$owner.Close()",
	"if ($ok) { Write-Output $d.SelectedPath }",
].join("\n");

const ENCODED_WINDOWS_PICKER = Buffer.from(WINDOWS_PICKER, "utf16le").toString("base64");

const WINDOWS_FILE_PICKER = WINDOWS_PICKER.replace(
	"$d = New-Object System.Windows.Forms.FolderBrowserDialog\n$d.Description = 'Open project'",
	"$d = New-Object System.Windows.Forms.OpenFileDialog\n$d.Title = 'Choose the agent executable'",
).replace("Write-Output $d.SelectedPath", "Write-Output $d.FileName");

const ENCODED_WINDOWS_FILE_PICKER = Buffer.from(WINDOWS_FILE_PICKER, "utf16le").toString("base64");

export type PickKind = "directory" | "file";

export function pickersFor(platform: NodeJS.Platform, kind: PickKind = "directory"): Picker[] {
	const file = kind === "file";
	switch (platform) {
		case "darwin":
			return [
				{
					cmd: [
						"osascript",
						"-e",
						file
							? 'POSIX path of (choose file with prompt "Choose the agent executable")'
							: 'POSIX path of (choose folder with prompt "Open project")',
					],
					parse: toPath,
					nonZeroExit: "cancel",
				},
			];
		case "linux":
			return [
				{
					cmd: file
						? ["zenity", "--file-selection", "--title=Choose the agent executable"]
						: ["zenity", "--file-selection", "--directory", "--title=Open project"],
					parse: toPath,
					nonZeroExit: "cancel",
				},
				{
					cmd: file
						? ["kdialog", "--getopenfilename", ".", "--title", "Choose the agent executable"]
						: ["kdialog", "--getexistingdirectory", ".", "--title", "Open project"],
					parse: toPath,
					nonZeroExit: "cancel",
				},
			];
		case "win32":
			return ["powershell.exe", "pwsh.exe"].map((shell) => ({
				cmd: [
					shell,
					"-NoProfile",
					"-Sta",
					"-EncodedCommand",
					file ? ENCODED_WINDOWS_FILE_PICKER : ENCODED_WINDOWS_PICKER,
				],
				parse: toPath,
				nonZeroExit: "error" as const,
			}));
		default:
			return [];
	}
}

function resolveOverride(kind: PickKind): string | null {
	const value = kind === "file" ? process.env.THINKRAIL_PICK_FILE : process.env.THINKRAIL_PICK_DIR;
	if (!value) return null;
	try {
		if (statSync(value).isFile()) return readFileSync(value, "utf8").trim() || null;
	} catch {}
	return value;
}

export function pickerFailure(stderr: string, code: number, kind: PickKind = "directory"): string {
	const firstLine = stderr.replaceAll("\r", "").trim().split("\n")[0];
	return `The ${kind === "file" ? "file" : "folder"} picker failed: ${firstLine || `exit ${code}`}`;
}

export function noPickerMessage(platform: NodeJS.Platform, kind: PickKind = "directory"): string {
	const what = kind === "file" ? "file" : "folder";
	return platform === "linux"
		? `No ${what} picker on this host — install zenity or kdialog.`
		: `No native ${what} picker is available on this host (${platform}).`;
}

export async function selectDirectory(): Promise<{ path: string | null }> {
	return selectPath("directory");
}

export async function selectFile(): Promise<{ path: string | null }> {
	return selectPath("file");
}

async function selectPath(kind: PickKind): Promise<{ path: string | null }> {
	const override = resolveOverride(kind);
	if (override) return { path: override };

	for (const picker of pickersFor(process.platform, kind)) {
		let out: string;
		let err: string;
		let code: number;
		try {
			const proc = Bun.spawn(picker.cmd, { stdout: "pipe", stderr: "pipe" });
			[out, err, code] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
		} catch {
			continue;
		}
		if (code === 0) return { path: picker.parse(out) };
		if (picker.nonZeroExit === "cancel") return { path: null };
		throw new Error(pickerFailure(err, code, kind));
	}
	throw new Error(noPickerMessage(process.platform, kind));
}
