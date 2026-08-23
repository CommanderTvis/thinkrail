import { readFileSync, statSync } from "node:fs";

export type PickKind = "directory" | "file";

interface PickerExecution {
	stdout: string;
	stderr: string;
	code: number;
}

export interface Picker {
	cmd: string[];
	parse: (stdout: string) => string | null;
	isCancellation: (execution: PickerExecution) => boolean;
}

type PickerRunner = (cmd: string[], env: NodeJS.ProcessEnv) => Promise<PickerExecution>;

interface SelectPickerOptions {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	runPicker?: PickerRunner;
}

type PickerOverride = { kind: "path"; path: string } | { kind: "error"; message: string };

const PICKER_ERROR_DIRECTIVE = "error:";
const toPath = (stdout: string): string | null => stdout.trim().replace(/[/\\]+$/, "") || null;

const appleScriptCancellation = ({ stderr }: PickerExecution): boolean => stderr.includes("(-128)");
const linuxCancellation = ({ code, stderr }: PickerExecution): boolean =>
	code === 1 && stderr.trim() === "";
const noNonZeroCancellation = (): boolean => false;

const PROMPT: Record<PickKind, string> = {
	directory: "Open project",
	file: "Choose a file",
};

function windowsPicker(kind: PickKind): string {
	const dialog =
		kind === "directory"
			? [
					"$d = New-Object System.Windows.Forms.FolderBrowserDialog",
					`$d.Description = '${PROMPT.directory}'`,
				]
			: [
					"$d = New-Object System.Windows.Forms.OpenFileDialog",
					`$d.Title = '${PROMPT.file}'`,
					"$d.Filter = 'All files (*.*)|*.*'",
				];
	const selected = kind === "directory" ? "$d.SelectedPath" : "$d.FileName";
	return [
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
		...dialog,
		"$ok = $d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK",
		"$owner.Close()",
		`if ($ok) { Write-Output ${selected} }`,
	].join("\n");
}

function encodedWindowsPicker(kind: PickKind): string {
	return Buffer.from(windowsPicker(kind), "utf16le").toString("base64");
}

export function pickersFor(platform: NodeJS.Platform, kind: PickKind): Picker[] {
	const prompt = PROMPT[kind];
	switch (platform) {
		case "darwin":
			return [
				{
					cmd: [
						"osascript",
						"-e",
						kind === "directory"
							? `POSIX path of (choose folder with prompt "${prompt}")`
							: `POSIX path of (choose file with prompt "${prompt}" invisibles true)`,
					],
					parse: toPath,
					isCancellation: appleScriptCancellation,
				},
			];
		case "linux":
			return [
				{
					cmd: [
						"zenity",
						"--file-selection",
						...(kind === "directory" ? ["--directory"] : []),
						`--title=${prompt}`,
					],
					parse: toPath,
					isCancellation: linuxCancellation,
				},
				{
					cmd: [
						"kdialog",
						kind === "directory" ? "--getexistingdirectory" : "--getopenfilename",
						".",
						"--title",
						prompt,
					],
					parse: toPath,
					isCancellation: linuxCancellation,
				},
			];
		case "win32":
			return ["powershell.exe", "pwsh.exe"].map((shell) => ({
				cmd: [shell, "-NoProfile", "-Sta", "-EncodedCommand", encodedWindowsPicker(kind)],
				parse: toPath,
				isCancellation: noNonZeroCancellation,
			}));
		default:
			return [];
	}
}

function pickerOverrideFromFile(value: string): PickerOverride | null {
	const content = readFileSync(value, "utf8").trim();
	if (!content) return null;
	if (!content.startsWith(PICKER_ERROR_DIRECTIVE)) return { kind: "path", path: content };
	const message = content.slice(PICKER_ERROR_DIRECTIVE.length).trim();
	return {
		kind: "error",
		message: message || "The picker failure directive requires a message.",
	};
}

const OVERRIDE_ENV: Record<PickKind, string> = {
	directory: "THINKRAIL_PICK_DIR",
	file: "THINKRAIL_PICK_FILE",
};

function resolveOverride(kind: PickKind, env: NodeJS.ProcessEnv): PickerOverride | null {
	const value = env[OVERRIDE_ENV[kind]];
	if (!value) return null;
	try {
		if (statSync(value).isFile()) return pickerOverrideFromFile(value);
	} catch {}
	return { kind: "path", path: value };
}

const NOUN: Record<PickKind, string> = { directory: "folder", file: "file" };

export function pickerFailure(kind: PickKind, stderr: string, code: number): string {
	const firstLine = stderr.replaceAll("\r", "").trim().split("\n")[0];
	return `The ${NOUN[kind]} picker failed: ${firstLine || `exit ${code}`}`;
}

export function noPickerMessage(platform: NodeJS.Platform, kind: PickKind): string {
	return platform === "linux"
		? `No ${NOUN[kind]} picker on this host — install zenity or kdialog.`
		: `No native ${NOUN[kind]} picker is available on this host (${platform}).`;
}

const defaultRunPicker: PickerRunner = async (cmd, env) => {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env });
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, code };
};

async function select(
	kind: PickKind,
	{
		platform = process.platform,
		env = process.env,
		runPicker = defaultRunPicker,
	}: SelectPickerOptions = {},
): Promise<{ path: string | null }> {
	const override = resolveOverride(kind, env);
	if (override?.kind === "error") throw new Error(override.message);
	if (override?.kind === "path") return { path: override.path };
	if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
		throw new Error(
			`No graphical session is available for the ${NOUN[kind]} picker on this Linux host.`,
		);
	}

	let firstFailure: string | null = null;
	let diagnosticFailure: string | null = null;
	for (const picker of pickersFor(platform, kind)) {
		let execution: PickerExecution;
		try {
			execution = await runPicker(picker.cmd, env);
		} catch {
			continue;
		}
		if (execution.code === 0) return { path: picker.parse(execution.stdout) };
		if (picker.isCancellation(execution)) return { path: null };
		const failure = pickerFailure(kind, execution.stderr, execution.code);
		firstFailure ??= failure;
		if (execution.stderr.trim()) diagnosticFailure ??= failure;
	}
	throw new Error(diagnosticFailure ?? firstFailure ?? noPickerMessage(platform, kind));
}

export function selectDirectory(options: SelectPickerOptions = {}): Promise<{
	path: string | null;
}> {
	return select("directory", options);
}

export function selectFile(options: SelectPickerOptions = {}): Promise<{ path: string | null }> {
	return select("file", options);
}
