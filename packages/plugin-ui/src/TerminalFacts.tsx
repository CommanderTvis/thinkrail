import { RiAttachment2 as AttachIcon, RiFolderLine as FolderLine } from "@remixicon/react";
import { abbreviateHomePath } from "./ScopedSetting";

const CWD_LABEL_MAX = 40;

export function cwdLabel(cwd: string | undefined): string | null {
	if (!cwd) return null;
	const abbreviated = abbreviateHomePath(cwd);
	if (abbreviated.length <= CWD_LABEL_MAX) return abbreviated;
	const segments = abbreviated.split("/");
	const head = segments[0] === "" ? "" : segments[0];
	const tail = segments.slice(-2).join("/");
	return `${head}/…/${tail}`;
}

function isAbsolute(path: string): boolean {
	return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

export function attachPath(
	path: string,
	worktreePath: string | undefined,
	cwd: string | undefined,
): string {
	const absolute = isAbsolute(path) ? path : worktreePath ? `${worktreePath}/${path}` : null;
	if (!absolute) return path;
	if (!cwd) return absolute;
	if (absolute.startsWith(`${cwd}/`)) return absolute.slice(cwd.length + 1);
	return absolute;
}

const CHIP =
	"flex max-w-[16rem] shrink-0 items-center gap-4 truncate rounded-[var(--radius-sm)] bg-container-elevated-bg px-4 tr-text-label-pill text-text-muted";

export function TerminalFactChip({
	kind,
	label,
	title,
}: {
	kind: string;
	label: string;
	title: string;
}) {
	return (
		<span
			data-testid="terminal-agent-fact"
			data-kind={kind}
			title={title}
			className={`${CHIP} ${kind === "cwd" ? "normal-case" : ""}`}
		>
			{kind === "cwd" ? <FolderLine className="size-12 shrink-0" /> : null}
			<span className="truncate">{label}</span>
		</span>
	);
}

export function TerminalAttachButton({
	title,
	pickFile,
	onAttach,
	onError,
}: {
	title: string;
	pickFile: () => Promise<string | null>;
	onAttach: (path: string) => void;
	onError: (cause: unknown) => void;
}) {
	return (
		<button
			type="button"
			data-testid="terminal-attach-file"
			title={title}
			onClick={() => {
				pickFile()
					.then((path) => {
						if (path) onAttach(path);
					})
					.catch(onError);
			}}
			className={`${CHIP} hover:bg-control-bg-hovered hover:text-text-default`}
		>
			<AttachIcon className="size-12" /> attach file
		</button>
	);
}
