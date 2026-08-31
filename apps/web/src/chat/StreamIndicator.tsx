import type { ChatMessage } from "@thinkrail/contracts";

export type StreamPhase = "working" | "thinking" | "running-tool" | "writing";

export interface StreamStatus {
	phase: StreamPhase;
	toolName?: string;
}

export function streamStatus(
	messages: ChatMessage[],
	currentAssistantId: string | null,
): StreamStatus {
	const lastMessage = messages.at(-1);
	const active =
		messages.find(
			(m): m is Extract<ChatMessage, { role: "assistant" }> =>
				m.role === "assistant" && m.id === currentAssistantId,
		) ??
		(currentAssistantId == null && lastMessage?.role === "assistant" ? lastMessage : undefined);
	const last = active?.blocks.at(-1);
	if (!last) return { phase: "working" };
	if (last.type === "toolCall") return { phase: "running-tool", toolName: last.toolName };
	if (last.type === "text") return last.text.trim() ? { phase: "writing" } : { phase: "working" };
	if (last.type === "thinking")
		return last.text.trim() ? { phase: "thinking" } : { phase: "working" };
	return { phase: "working" };
}

export function phaseLabel({ phase, toolName }: StreamStatus): string {
	switch (phase) {
		case "thinking":
			return "Thinking…";
		case "writing":
			return "Writing…";
		case "running-tool":
			return toolName ? `Running ${toolName}…` : "Running tool…";
		default:
			return "Working…";
	}
}

function TypingDots() {
	return (
		<span className="flex items-center gap-2" aria-hidden="true">
			<span className="size-6 animate-pulse rounded-full bg-current" />
			<span className="size-6 animate-pulse rounded-full bg-current [animation-delay:200ms]" />
			<span className="size-6 animate-pulse rounded-full bg-current [animation-delay:400ms]" />
		</span>
	);
}

export function StreamIndicator({ status }: { status: StreamStatus }) {
	return (
		<div
			data-testid="stream-indicator"
			data-phase={status.phase}
			role="status"
			aria-live="polite"
			className="flex items-center gap-8 py-4 text-text-muted tr-text-metadata"
		>
			<TypingDots />
			<span>{phaseLabel(status)}</span>
		</div>
	);
}
