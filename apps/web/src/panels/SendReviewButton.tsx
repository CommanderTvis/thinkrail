import {
	RiMessage2Line as ChatIcon,
	RiArrowDownSLine as ChevronDown,
	RiSendPlaneLine as Send,
	RiTerminalBoxLine as TerminalIcon,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useMemo, useState } from "react";
import { reviewTargets, selectCanSendReviewToTerminal, useAppStore } from "../store";
import { allDraftIds, fileDraftIds } from "./reviewModel";
import { type ReviewRecipient, sendReviewBatch } from "./reviewSend";

const NO_TABS: never[] = [];

export function SendReviewButton({
	workspaceId,
	path,
	chatSessionId,
	testid = "send-review-button",
}: {
	workspaceId: string;
	path: string | readonly string[] | null;
	chatSessionId?: string | undefined;
	testid?: string;
}) {
	const t = useT();
	const comments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);
	const draftIds = useMemo(
		() =>
			typeof path === "string" || path === null
				? fileDraftIds(comments, path)
				: path.flatMap((each) => fileDraftIds(comments, each)),
		[comments, path],
	);
	return (
		<SendButtonBase
			workspaceId={workspaceId}
			testid={testid}
			label={t("panels.sendReview.file", { total: draftIds.length })}
			count={draftIds.length}
			send={(recipient) =>
				sendReviewBatch(
					workspaceId,
					draftIds,
					recipient ?? (chatSessionId ? { sessionId: chatSessionId } : undefined),
				)
			}
		/>
	);
}

export function SendAllReviewsButton({
	workspaceId,
	testid = "review-send-all",
	verb,
}: {
	workspaceId: string;
	testid?: string;
	verb?: string;
}) {
	const t = useT();
	const comments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);
	const count = useMemo(() => allDraftIds(comments).length, [comments]);
	return (
		<SendButtonBase
			workspaceId={workspaceId}
			testid={testid}
			label={t("panels.sendReview.withCount", {
				verb: verb ?? t("panels.sendReview.sendAll"),
				total: count,
			})}
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
	const t = useT();
	const [busy, setBusy] = useState(false);
	const tabs = useAppStore((s) => s.tabsByWorkspace[workspaceId] ?? NO_TABS);
	const terminals = useAppStore((s) => s.terminalsByWorkspace[workspaceId] ?? NO_TABS);
	const terminalsAllowed = useAppStore(selectCanSendReviewToTerminal);
	const targets = useMemo(
		() => reviewTargets(t("panels.sendReview.untitledChat"), tabs, terminals, terminalsAllowed),
		[t, tabs, terminals, terminalsAllowed],
	);
	if (count === 0) return null;
	const run = async (recipient?: ReviewRecipient) => {
		setBusy(true);
		await send(recipient)
			.catch(() => {})
			.finally(() => setBusy(false));
	};
	return (
		<span className="flex shrink-0 items-stretch gap-2">
			<Button
				variant="primary"
				size="m"
				iconLeft={Send}
				data-testid={testid}
				loading={busy}
				onClick={() => void run()}
			>
				{label}
			</Button>
			{targets.length > 0 ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<IconButton
							variant="primary"
							size="m"
							icon={ChevronDown}
							label={t("panels.sendReview.sendTo")}
							data-testid={`${testid}-target`}
							disabled={busy}
						/>
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
