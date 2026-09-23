import {
	RiMessage2Line as ChatIcon,
	RiArrowDownSLine as ChevronDown,
	RiSendPlaneLine as Send,
	RiTerminalBoxLine as TerminalIcon,
} from "@remixicon/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/plugin-ui";
import { useMemo, useState } from "react";
import { reviewTargets, selectCanSendReviewToTerminal, useAppStore } from "../store";
import { allDraftIds, fileDraftIds } from "./reviewModel";
import { type ReviewRecipient, sendReviewBatch } from "./reviewSend";

const NO_TABS: never[] = [];

export function SendReviewButton({
	workspaceId,
	path,
	testid = "send-review-button",
}: {
	workspaceId: string;
	path: string | null;
	testid?: string;
}) {
	const comments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);
	const draftIds = useMemo(() => fileDraftIds(comments, path), [comments, path]);
	return (
		<SendButtonBase
			workspaceId={workspaceId}
			testid={testid}
			label={`Send review (${draftIds.length})`}
			count={draftIds.length}
			send={(recipient) => sendReviewBatch(workspaceId, draftIds, recipient)}
		/>
	);
}

export function SendAllReviewsButton({ workspaceId }: { workspaceId: string }) {
	const comments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);
	const count = useMemo(() => allDraftIds(comments).length, [comments]);
	return (
		<SendButtonBase
			workspaceId={workspaceId}
			testid="review-send-all"
			label={`Send all (${count})`}
			count={count}
			send={(recipient) => sendReviewBatch(workspaceId, undefined, recipient)}
		/>
	);
}

function SendButtonBase({
	workspaceId,
	testid,
	label,
	count,
	send,
}: {
	workspaceId: string;
	testid: string;
	label: string;
	count: number;
	send: (recipient?: ReviewRecipient) => Promise<void>;
}) {
	const [busy, setBusy] = useState(false);
	const tabs = useAppStore((s) => s.tabsByWorkspace[workspaceId] ?? NO_TABS);
	const terminals = useAppStore((s) => s.terminalsByWorkspace[workspaceId] ?? NO_TABS);
	const terminalsAllowed = useAppStore(selectCanSendReviewToTerminal);
	const targets = useMemo(
		() => reviewTargets(tabs, terminals, terminalsAllowed),
		[tabs, terminals, terminalsAllowed],
	);
	if (count === 0) return null;
	const run = async (recipient?: ReviewRecipient) => {
		setBusy(true);
		try {
			await send(recipient);
		} catch {
		} finally {
			setBusy(false);
		}
	};
	return (
		<span className="flex h-24 shrink-0 items-stretch">
			<button
				type="button"
				data-testid={testid}
				disabled={busy}
				onClick={() => void run()}
				className={`flex items-center gap-4 bg-control-primary-bg px-8 text-control-primary-text tr-text-action transition-colors hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text ${
					targets.length > 0 ? "rounded-l-[var(--radius-sm)]" : "rounded-[var(--radius-sm)]"
				}`}
			>
				<Send className="size-12" />
				{label}
			</button>
			{targets.length > 0 ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							data-testid={`${testid}-target`}
							aria-label="Send to…"
							disabled={busy}
							className="flex items-center rounded-r-[var(--radius-sm)] bg-control-primary-bg px-2 text-control-primary-text transition-colors hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
						>
							<ChevronDown className="size-12" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" data-testid="review-send-targets">
						{targets.map((target) =>
							target.kind === "chat" ? (
								<DropdownMenuItem
									key={`chat-${target.sessionId}`}
									data-testid="review-send-target"
									data-kind="chat"
									onSelect={() => void run({ sessionId: target.sessionId })}
								>
									<ChatIcon className="size-14" />
									{target.title}
								</DropdownMenuItem>
							) : (
								<DropdownMenuItem
									key={`terminal-${target.tabKey}`}
									data-testid="review-send-target"
									data-kind="terminal"
									onSelect={() => void run({ terminal: target.tabKey })}
								>
									<TerminalIcon className="size-14" />
									{target.title}
								</DropdownMenuItem>
							),
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</span>
	);
}
