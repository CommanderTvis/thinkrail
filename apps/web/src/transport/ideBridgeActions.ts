import type { IdeActionRequest } from "@thinkrail/contracts";

/**
 * The seam that lets an inbound IDE action reach `panels` without `transport` importing it — the mirror of
 * the host's own injected publishers. Registered once at startup; see transport/SPEC.md.
 */
type IdeActionHandler = (request: IdeActionRequest) => void;

let handler: IdeActionHandler | null = null;

export function setIdeActionHandler(next: IdeActionHandler | null): void {
	handler = next;
}

export function dispatchIdeAction(request: IdeActionRequest): void {
	handler?.(request);
}
