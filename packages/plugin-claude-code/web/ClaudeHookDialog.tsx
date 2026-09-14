import { RiCheckLine as Check, RiArrowDownSLine as ChevronDown } from "@remixicon/react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@thinkrail/plugin-ui";
import { useState } from "react";
import type { ClaudeEdit, ClaudeHookEvent } from "../contracts";
import { CLAUDE_HOOK_EVENTS } from "../webValues";
import { ComposeActions, FIELD_CLASS, Field } from "./ClaudeConfigParts";

/** Only these events take a tool matcher; for the rest the field would be a control that does nothing. */
const MATCHED_EVENTS: readonly ClaudeHookEvent[] = ["PreToolUse", "PostToolUse"];

/** Describe the hook, before anything is asked about where it goes — see panels/SPEC.md. */
export function ClaudeHookDialog({
	open,
	onClose,
	onCompose,
}: {
	open: boolean;
	onClose: () => void;
	onCompose: (pending: { edit: ClaudeEdit; title: string }) => void;
}) {
	const [event, setEvent] = useState<ClaudeHookEvent>("PreToolUse");
	const [matcher, setMatcher] = useState("");
	const [command, setCommand] = useState("");
	const matched = MATCHED_EVENTS.includes(event);

	const problem = command.trim() === "" ? "A command is needed." : null;

	return (
		<Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
			<DialogContent className="flex w-full max-w-[34rem] flex-col gap-12">
				<DialogHeader>
					<DialogTitle>Add a hook</DialogTitle>
				</DialogHeader>

				<Field label="When it runs">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="outline"
								aria-label="Hook event"
								data-testid="claude-hook-event"
								className="w-full justify-between"
							>
								<span className="truncate">{event}</span>
								<ChevronDown className="size-16" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="start"
							className="w-[var(--radix-dropdown-menu-trigger-width)]"
						>
							<DropdownMenuRadioGroup
								value={event}
								onValueChange={(value) => setEvent(value as ClaudeHookEvent)}
							>
								{CLAUDE_HOOK_EVENTS.map((candidate) => (
									<DropdownMenuRadioItem
										key={candidate}
										value={candidate}
										data-testid={`claude-hook-event-${candidate}`}
									>
										{candidate === event ? (
											<Check className="size-14 text-primary" />
										) : (
											<span className="size-14 shrink-0" />
										)}
										<span>{candidate}</span>
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				</Field>

				{matched ? (
					<Field label="For which tools" hint="A regex over tool names; empty means every tool.">
						<input
							value={matcher}
							onChange={(change) => setMatcher(change.target.value)}
							spellCheck={false}
							aria-label="Tool matcher"
							data-testid="claude-hook-matcher"
							placeholder="Edit|Write"
							className={FIELD_CLASS}
						/>
					</Field>
				) : null}

				<Field label="Command">
					<input
						value={command}
						onChange={(change) => setCommand(change.target.value)}
						spellCheck={false}
						aria-label="Hook command"
						data-testid="claude-hook-command"
						placeholder="$CLAUDE_PROJECT_DIR/.claude/hooks/format.sh"
						className={FIELD_CLASS}
					/>
				</Field>

				<p className="tr-text-metadata text-text-muted">
					A hook is a shell command Claude Code runs on your machine, with your permissions, every
					time the event fires.
				</p>

				<ComposeActions
					testid="claude-hook"
					problem={problem}
					onCancel={onClose}
					onSubmit={() =>
						onCompose({
							edit: {
								kind: "hook",
								event,
								matcher: matched ? matcher.trim() : "",
								command: command.trim(),
							},
							title: `Add a ${event} hook`,
						})
					}
				/>
			</DialogContent>
		</Dialog>
	);
}
