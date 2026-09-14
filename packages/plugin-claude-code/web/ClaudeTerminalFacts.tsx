import {
	RiArrowDownSLine as ChevronDown,
	RiListCheck2 as PlanIcon,
	RiLoader4Line as TodoActive,
	RiCheckboxCircleFill as TodoDone,
	RiCheckboxBlankCircleLine as TodoPending,
} from "@remixicon/react";
import type { PluginWebContext, TerminalAccessoryApi } from "@thinkrail/plugin-api/web";
import {
	attachPath,
	cwdLabel,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	TerminalAttachButton,
	TerminalFactChip,
} from "@thinkrail/plugin-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentTodoItem, claudeCodeContract } from "../contracts";
import {
	CLAUDE_EFFORT_LEVELS,
	type ClaudeEffortLevel,
	driveEffortPicker,
} from "./claudeEffortPicker";
import { CLAUDE_MODELS } from "./claudeLaunch";
import {
	composerDraft,
	driveModelPicker,
	type ModelPickerIo,
	type ModelPickerOutcome,
} from "./claudeModelPicker";
import { errorText } from "./errorText";
import type { ClaudeCodeSessionState } from "./store";
import { useClaudeCodeStore } from "./store";

const PICKER_TAIL_LINES = 48;

/**
 * A model id is long and mostly prefix; the part that identifies it is what fits in a chip, with the id
 * itself on hover. Effort is shown as the agent words it.
 */
function agentFacts(
	state: ClaudeCodeSessionState | undefined,
): { kind: string; label: string; title: string }[] {
	if (!state) return [];
	const facts: { kind: string; label: string; title: string }[] = [];
	const directory = cwdLabel(state.cwd);
	if (directory && state.cwd) {
		facts.push({ kind: "cwd", label: directory, title: `Claude started in ${state.cwd}` });
	}
	if (state.model) {
		facts.push({
			kind: "model",
			label: state.model.replace(/^claude-/, "").replace(/-\d{8}$/, ""),
			title: state.model,
		});
	}
	if (state.effort) {
		facts.push({ kind: "effort", label: `${state.effort} effort`, title: "Reasoning effort" });
	}
	return facts;
}

function TerminalPlan({ todos }: { todos: readonly AgentTodoItem[] }) {
	const [open, setOpen] = useState(false);
	const done = todos.filter((todo) => todo.status === "completed").length;
	return (
		<span className="relative flex shrink-0">
			<button
				type="button"
				data-testid="terminal-plan-toggle"
				aria-expanded={open}
				title={open ? "Hide Claude's plan" : "Show Claude's plan"}
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

export function createClaudeTerminalFacts(ctx: PluginWebContext<typeof claudeCodeContract>) {
	return function ClaudeTerminalFacts({ terminal }: { terminal: TerminalAccessoryApi }) {
		const agent = ctx
			.host()
			.terminals[terminal.workspaceId]?.find(
				(candidate) => candidate.tabKey === terminal.tabKey,
			)?.agent;
		const state = useClaudeCodeStore((s) => s.byWorkspace[terminal.workspaceId]?.[terminal.tabKey]);
		const worktreePath = Object.values(ctx.host().workspaces)
			.flat()
			.find((w) => w.id === terminal.workspaceId)?.worktreePath;

		const agentKind = agent?.kind;
		useEffect(() => {
			terminal.setKeyEncoding(agentKind === "claude" ? "agent-newline" : "default");
			return () => terminal.setKeyEncoding("default");
		}, [agentKind, terminal]);

		const driving = useRef(false);
		const [drivingWhat, setDrivingWhat] = useState<"model" | "effort" | null>(null);
		const overlayRef = useRef<HTMLDivElement>(null);
		useEffect(() => {
			if (drivingWhat) overlayRef.current?.focus();
		}, [drivingWhat]);

		const drivePicker = useCallback(
			(
				what: "model" | "effort",
				choice: string,
				drive: (io: ModelPickerIo, choice: string) => Promise<ModelPickerOutcome>,
			) => {
				if (driving.current) return;
				driving.current = true;
				setDrivingWhat(what);
				void drive(
					{
						write: terminal.write,
						readLines: () => terminal.bufferTail(PICKER_TAIL_LINES),
						delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
					},
					choice,
				)
					.then((outcome) => {
						if (outcome === "switched") {
							if (what === "effort" && state) {
								useClaudeCodeStore.getState().applyPush({
									workspaceId: terminal.workspaceId,
									tabKey: terminal.tabKey,
									status: state.status,
									report: { event: "effort_switch", effort: choice },
								});
							}
							return;
						}
						ctx.notify(
							"error",
							`Couldn't switch the ${what}`,
							outcome === "draft"
								? "Send or clear what you typed at Claude's prompt first."
								: outcome === "no-picker"
									? `Claude Code didn't open its ${what} picker — is the session waiting at its prompt?`
									: `The ${what} picker didn't offer ${choice}.`,
						);
					})
					.catch(() =>
						ctx.notify(
							"error",
							`Couldn't switch the ${what}`,
							"The terminal stopped answering while the picker was open.",
						),
					)
					.finally(() => {
						driving.current = false;
						setDrivingWhat(null);
					});
			},
			[state, terminal],
		);
		const switchModel = useCallback(
			(model: string) => drivePicker("model", model, driveModelPicker),
			[drivePicker],
		);
		const switchEffort = useCallback(
			(level: ClaudeEffortLevel) =>
				drivePicker("effort", level, (io, choice) =>
					driveEffortPicker(io, choice as ClaudeEffortLevel),
				),
			[drivePicker],
		);
		const [draft, setDraft] = useState<string | null>(null);
		const noteDraft = useCallback(
			(open: boolean) => {
				if (!open) return;
				setDraft(composerDraft(terminal.bufferTail(PICKER_TAIL_LINES)) ?? null);
			},
			[terminal],
		);
		const draftNote =
			draft === null ? null : (
				<DropdownMenuItem disabled data-testid="terminal-menu-draft">
					Send or clear what you typed first
				</DropdownMenuItem>
			);

		const attach = useCallback(
			(path: string) => {
				const data = `@${attachPath(path, worktreePath, state?.cwd)} `;
				terminal.write(data);
			},
			[terminal, worktreePath, state?.cwd],
		);

		if (agent?.kind !== "claude") return null;
		const facts = agentFacts(state);

		return (
			<>
				<div
					data-testid="terminal-agent-facts"
					className="flex min-w-0 flex-1 flex-wrap items-center gap-4"
				>
					{facts.map((fact) =>
						fact.kind === "model" ? (
							<DropdownMenu key={fact.kind} onOpenChange={noteDraft}>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										data-testid="terminal-agent-fact"
										data-kind="model"
										title={`${fact.title} — click to switch`}
										className="flex max-w-[16rem] shrink-0 cursor-pointer items-center gap-2 truncate rounded-[var(--radius-sm)] bg-container-elevated-bg px-4 tr-text-label-pill text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
									>
										<span className="truncate">{fact.label}</span>
										<ChevronDown className="size-12 shrink-0" />
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent data-testid="terminal-model-menu" align="start" side="top">
									{draftNote ??
										CLAUDE_MODELS.map((model) => (
											<DropdownMenuItem key={model.id} onSelect={() => switchModel(model.id)}>
												{model.label}
											</DropdownMenuItem>
										))}
								</DropdownMenuContent>
							</DropdownMenu>
						) : fact.kind === "effort" ? (
							<DropdownMenu key={fact.kind} onOpenChange={noteDraft}>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										data-testid="terminal-agent-fact"
										data-kind="effort"
										title={`${fact.title} — click to change`}
										className="flex max-w-[16rem] shrink-0 cursor-pointer items-center gap-2 truncate rounded-[var(--radius-sm)] bg-container-elevated-bg px-4 tr-text-label-pill text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
									>
										<span className="truncate">{fact.label}</span>
										<ChevronDown className="size-12 shrink-0" />
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent data-testid="terminal-effort-menu" align="start" side="top">
									{draftNote ??
										CLAUDE_EFFORT_LEVELS.map((level) => (
											<DropdownMenuItem key={level} onSelect={() => switchEffort(level)}>
												{level}
											</DropdownMenuItem>
										))}
								</DropdownMenuContent>
							</DropdownMenu>
						) : (
							<TerminalFactChip key={fact.kind} {...fact} />
						),
					)}
					{state?.todos?.length ? <TerminalPlan todos={state.todos} /> : null}
					<TerminalAttachButton
						title="Put a file or folder in front of Claude, as @path"
						pickFile={() => ctx.pickFile()}
						onAttach={attach}
						onError={(cause) =>
							ctx.notify("error", "Couldn't open the file picker", errorText(cause))
						}
					/>
				</div>
				{drivingWhat ? (
					<div
						ref={overlayRef}
						tabIndex={-1}
						data-testid="terminal-driving-overlay"
						data-kind={drivingWhat}
						role="status"
						onBlur={(event) => {
							if (drivingWhat) event.currentTarget.focus();
						}}
						className="absolute inset-0 z-30 flex cursor-progress flex-col items-center justify-center bg-overlay outline-none"
					>
						<p className="tr-text-metadata text-text-muted">
							Driving Claude Code's {drivingWhat} picker…
						</p>
					</div>
				) : null}
			</>
		);
	};
}
