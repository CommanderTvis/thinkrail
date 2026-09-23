import {
	RiAttachment2 as AttachIcon,
	RiCodeLine as CodeIcon,
	RiFolderLine as FolderLine,
	RiListCheck2 as PlanIcon,
	RiLoader4Line as TodoActive,
	RiCheckboxCircleFill as TodoDone,
	RiCheckboxBlankCircleLine as TodoPending,
} from "@remixicon/react";
import { useState } from "react";
import { abbreviateHomePath } from "./ScopedSetting";
import { type TokenUsage, tokenUsageParts } from "./tokenUsage";

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

export function TerminalIdeContextChip({
	enabled,
	onToggle,
}: {
	enabled: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			data-testid="terminal-ide-context-toggle"
			data-enabled={enabled}
			aria-pressed={enabled}
			title={
				enabled ? "Stop sending IDE context to this session" : "Send IDE context to this session"
			}
			onClick={onToggle}
			className={`${CHIP} hover:bg-control-bg-hovered hover:text-text-default`}
		>
			<CodeIcon className="size-12 shrink-0" />
			<span>{enabled ? "IDE context on" : "IDE context off"}</span>
		</button>
	);
}

export function TerminalUsageChip({ agent, usage }: { agent: string; usage: TokenUsage }) {
	const parts = tokenUsageParts(usage);
	if (parts.length === 0) return null;
	return (
		<span
			data-testid="terminal-agent-fact"
			data-kind="usage"
			title={`Tokens this ${agent} session has spent, from its own transcript: ↑ input · ↓ output · R cache read · W cache write`}
			className={CHIP}
		>
			<span className="truncate">{parts.join(" · ")}</span>
		</span>
	);
}

export interface TerminalTodo {
	content: string;
	status: "pending" | "in_progress" | "completed";
	activeForm?: string;
}

export function TerminalPlan({ agent, todos }: { agent: string; todos: readonly TerminalTodo[] }) {
	const [open, setOpen] = useState(false);
	const done = todos.filter((todo) => todo.status === "completed").length;
	return (
		<span className="relative flex shrink-0">
			<button
				type="button"
				data-testid="terminal-plan-toggle"
				aria-expanded={open}
				title={open ? `Hide ${agent}'s plan` : `Show ${agent}'s plan`}
				onClick={() => setOpen((current) => !current)}
				className="flex shrink-0 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] bg-container-elevated-bg px-4 tr-text-label-pill text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			>
				<PlanIcon className="size-12 shrink-0" />
				<span>
					{done}/{todos.length}
				</span>
			</button>
			{open ? (
				<div
					data-testid="terminal-plan"
					className="absolute bottom-full left-0 z-20 mb-4 max-h-[40vh] w-[28rem] max-w-[80vw] overflow-auto rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg p-8"
				>
					<ul className="flex flex-col gap-4">
						{todos
							.map((todo, index) => ({ rowKey: `${index}-${todo.content}`, todo }))
							.map(({ rowKey, todo }) => (
								<li
									key={rowKey}
									data-testid="terminal-plan-item"
									data-status={todo.status}
									className={`flex items-start gap-8 tr-text-metadata ${
										todo.status === "in_progress" ? "text-text-default" : "text-text-muted"
									}`}
								>
									{todo.status === "completed" ? (
										<TodoDone className="mt-2 size-12 shrink-0 text-feedback-success" />
									) : todo.status === "in_progress" ? (
										<TodoActive className="mt-2 size-12 shrink-0 animate-spin text-primary" />
									) : (
										<TodoPending className="mt-2 size-12 shrink-0" />
									)}
									<span className={todo.status === "completed" ? "line-through opacity-70" : ""}>
										{todo.status === "in_progress" && todo.activeForm
											? todo.activeForm
											: todo.content}
									</span>
								</li>
							))}
					</ul>
				</div>
			) : null}
		</span>
	);
}
