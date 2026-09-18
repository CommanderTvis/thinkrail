import { RiArrowDownSLine as ChevronDown } from "@remixicon/react";
import type { PluginWebContext, TerminalAccessoryApi } from "@thinkrail/plugin-api/web";
import {
	attachPath,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	TerminalAttachButton,
	TerminalIdeContextChip,
	TerminalPlan,
	TerminalUsageChip,
} from "@thinkrail/plugin-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { codexContract } from "../contracts";
import { GptGlyph } from "./CodexGlyph";
import { createCodexSubscriptionNotice } from "./CodexSubscriptionNotice";
import { composerDraft, driveModelPicker } from "./codexModelPicker";
import { useCodexStore } from "./store";

const PICKER_TAIL_LINES = 48;

export function createCodexTerminalFacts(
	ctx: PluginWebContext<typeof codexContract>,
	initialIdeContextForTerminal: (terminal: TerminalAccessoryApi) => boolean,
) {
	const CodexSubscriptionNotice = createCodexSubscriptionNotice(ctx);
	return function CodexTerminalFacts({ terminal }: { terminal: TerminalAccessoryApi }) {
		const isCodex = ctx.useHost(
			(host) =>
				host.terminals[terminal.workspaceId]?.find(
					(candidate) => candidate.tabKey === terminal.tabKey,
				)?.agent?.kind === "codex",
		);
		const worktreePath = ctx.useHost(
			(host) =>
				Object.values(host.workspaces)
					.flat()
					.find((workspace) => workspace.id === terminal.workspaceId)?.worktreePath,
		);
		const state = useCodexStore((s) => s.byWorkspace[terminal.workspaceId]?.[terminal.tabKey]);
		const ideContextKey = `${terminal.workspaceId}\u0000${terminal.tabKey}`;
		const ideContextEnabled = useCodexStore((s) => s.ideContextByTerminal[ideContextKey]);
		const setIdeContext = useCodexStore((s) => s.setIdeContext);
		const models = useCodexStore((s) => s.models);
		useEffect(() => {
			if (!isCodex || ideContextEnabled !== undefined) return;
			const enabled = initialIdeContextForTerminal(terminal);
			setIdeContext(terminal.workspaceId, terminal.tabKey, enabled);
			if (!enabled) return;
			// Codex has no flag or terminal environment setting for this; https://github.com/openai/codex/issues/30181 tracks the missing startup support.
			terminal.write("/ide on\r");
		}, [ideContextEnabled, isCodex, setIdeContext, terminal]);

		const [driving, setDriving] = useState(false);
		const overlayRef = useRef<HTMLDivElement>(null);
		useEffect(() => {
			if (driving) overlayRef.current?.focus();
		}, [driving]);
		const [draft, setDraft] = useState<string | null>(null);
		const noteDraft = useCallback(
			(open: boolean) => {
				if (open) {
					setDraft(
						composerDraft(terminal.bufferTail(PICKER_TAIL_LINES, { omitFaint: true })) ?? null,
					);
				}
			},
			[terminal],
		);

		const switchModel = (model: string) => {
			if (driving) return;
			setDriving(true);
			void driveModelPicker(
				{
					write: terminal.write,
					readLines: (options) => terminal.bufferTail(PICKER_TAIL_LINES, options),
					delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
				},
				model,
			)
				.then((outcome) => {
					if (outcome === "switched") {
						useCodexStore.getState().applyPush({
							workspaceId: terminal.workspaceId,
							tabKey: terminal.tabKey,
							status: state?.status ?? "idle",
							event: "model_switch",
							model,
						});
						return;
					}
					ctx.notify(
						"error",
						"Couldn't switch the model",
						outcome === "draft"
							? "Send or clear what you typed at Codex's prompt first."
							: outcome === "no-picker"
								? "Codex didn't open its model picker — is the session waiting at its prompt?"
								: outcome === "no-session-key"
									? "This Codex can only save a model as your default. Update Codex to 0.156 or newer to switch for one session."
									: `Codex's model picker didn't offer ${model}.`,
					);
				})
				.catch(() =>
					ctx.notify(
						"error",
						"Couldn't switch the model",
						"The terminal stopped answering while the picker was open.",
					),
				)
				.finally(() => setDriving(false));
		};

		if (!isCodex) return null;
		const toggleIdeContext = () => {
			const next = !(ideContextEnabled ?? false);
			terminal.write(`/ide ${next ? "on" : "off"}\r`);
			setIdeContext(terminal.workspaceId, terminal.tabKey, next);
		};

		return (
			<>
				<div
					data-testid="terminal-agent-facts"
					className="flex min-w-0 flex-1 flex-wrap items-center gap-4"
				>
					<DropdownMenu onOpenChange={noteDraft}>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								data-testid="terminal-agent-fact"
								data-kind="model"
								title={`${state?.model ?? "Codex's model"} — click to switch`}
								className="flex max-w-[16rem] shrink-0 cursor-pointer items-center gap-2 truncate rounded-[var(--radius-sm)] bg-container-elevated-bg px-4 tr-text-label-pill text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
							>
								<span className="truncate">{state?.model ?? "Model"}</span>
								<ChevronDown className="size-12 shrink-0" />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent data-testid="terminal-model-menu" align="start" side="top">
							{draft !== null ? (
								<DropdownMenuItem disabled data-testid="terminal-menu-draft">
									Send or clear what you typed first
								</DropdownMenuItem>
							) : (
								models.map((model) => (
									<DropdownMenuItem key={model.id} onSelect={() => switchModel(model.id)}>
										<GptGlyph />
										{model.label}
									</DropdownMenuItem>
								))
							)}
						</DropdownMenuContent>
					</DropdownMenu>
					{state?.usage ? <TerminalUsageChip agent="Codex" usage={state.usage} /> : null}
					{state?.plan?.length ? <TerminalPlan agent="Codex" todos={state.plan} /> : null}
					<TerminalIdeContextChip
						enabled={ideContextEnabled ?? false}
						onToggle={toggleIdeContext}
					/>
					<TerminalAttachButton
						title="Put a file or folder's path in front of Codex"
						pickFile={() => ctx.pickFile()}
						onAttach={(path) => terminal.write(`${attachPath(path, worktreePath, state?.cwd)} `)}
						onError={(cause) =>
							ctx.notify(
								"error",
								"Couldn't open the file picker",
								cause instanceof Error ? cause.message : String(cause),
							)
						}
					/>
					<CodexSubscriptionNotice key={terminal.tabKey} terminal={terminal} />
				</div>
				{driving ? (
					<div
						ref={overlayRef}
						tabIndex={-1}
						data-testid="terminal-driving-overlay"
						data-kind="model"
						role="status"
						onBlur={(event) => event.currentTarget.focus()}
						className="absolute inset-0 z-30 flex cursor-progress flex-col items-center justify-center bg-overlay outline-none"
					>
						<p className="tr-text-metadata text-text-muted">Driving Codex's model picker…</p>
					</div>
				) : null}
			</>
		);
	};
}
