import type { MessageId } from "@thinkrail/contracts";
import type { SessionClock } from "./ports";

export interface StagingClock extends SessionClock {
	mint(): MessageId;
	stage(messageId: MessageId): void;
}

export function createStagingClock(
	mint: () => MessageId = () => crypto.randomUUID(),
	now: () => number = Date.now,
): StagingClock {
	let staged: MessageId | null = null;
	return {
		now,
		mint,
		nextId(): MessageId {
			const held = staged;
			staged = null;
			return held ?? mint();
		},
		stage(messageId: MessageId): void {
			staged = messageId;
		},
	};
}
