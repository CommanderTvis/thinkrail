import type { AgentDescriptor, SessionUsage } from "@thinkrail/contracts";
import type { ReactNode } from "react";
import { AgentBadge } from "./AgentBadge";
import { SessionStatsBar, type UsageCapabilities } from "./SessionStatsBar";
import { SkillsButton } from "./SkillsButton";

export function ChatHeader({
	usage,
	capabilities,
	agent,
	left,
	onOpenSkills,
	skillsStale,
}: {
	usage: SessionUsage | null;
	capabilities: UsageCapabilities;
	agent: AgentDescriptor;
	left?: ReactNode;
	onOpenSkills?: () => void;
	skillsStale?: boolean;
}) {
	return (
		<div
			data-testid="chat-toolbar"
			className="flex h-panel-header-row shrink-0 items-center gap-12 overflow-clip border-border-muted border-b bg-container-workspace-bg px-12"
		>
			<div className="flex min-w-0 flex-1 items-center overflow-clip">{left}</div>
			<div className="flex min-w-0 items-center justify-end gap-12 overflow-clip">
				<AgentBadge agent={agent} />
				<SessionStatsBar usage={usage} capabilities={capabilities} />
			</div>
			{onOpenSkills ? (
				<SkillsButton onOpen={onOpenSkills} testId="open-skills" stale={skillsStale ?? false} />
			) : null}
		</div>
	);
}
