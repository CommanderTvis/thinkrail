import type { ChatTurn } from "../../types";

export interface LatestVisualization {
	toolCallId: string;
	args: Record<string, unknown>;
}

/** The newest visualize call in a transcript — what a chat's embedded pane shows live. */
export function latestVisualization(turns: readonly ChatTurn[]): LatestVisualization | null {
	for (let i = turns.length - 1; i >= 0; i--) {
		const turn = turns[i];
		if (turn?.kind !== "assistant") continue;
		const content = turn.message.content;
		for (let j = content.length - 1; j >= 0; j--) {
			const block = content[j];
			if (block?.type === "toolCall" && block.name === "visualize") {
				return {
					toolCallId: block.id,
					args: (block.arguments ?? {}) as Record<string, unknown>,
				};
			}
		}
	}
	return null;
}
