import type { AgentDescriptor } from "@thinkrail/contracts";

export function AgentBadge({ agent }: { agent: AgentDescriptor }) {
	return (
		<span
			data-testid="chat-agent-badge"
			title={agent.name}
			className="flex shrink-0 items-center gap-4 overflow-clip rounded-[var(--radius-sm)] px-8 py-2 text-text-muted tr-text-metadata"
		>
			{agent.icon ? (
				<img
					src={agent.icon}
					alt=""
					className="size-14 shrink-0 rounded-[var(--radius-sm)] bg-container-logo-chip-bg p-px"
				/>
			) : (
				<span className="size-6 shrink-0 rounded-full bg-feedback-success" aria-hidden />
			)}
			<span className="truncate">{agent.name}</span>
		</span>
	);
}
