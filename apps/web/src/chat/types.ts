import type { ImageBlock } from "@thinkrail/contracts";

export interface ChatAttachment {
	name: string;
	content: ImageBlock;
}

export type FailureRecovery = "try-again";

export type ToolStatus = "running" | "done" | "error";

export interface ToolResultState {
	status: ToolStatus;
	raw: unknown;
}
