import type { UnknownRecord } from "../translate";
import { asRecord, asString } from "../translate";

export type FrameDirection = "in" | "out";

export type FrameKind = "request" | "response" | "notification";

export interface FrameRecord {
	at: number;
	direction: FrameDirection;
	raw: string;
}

export interface ClassifiedFrame {
	direction: FrameDirection;
	kind: FrameKind;
	method: string | undefined;
	frame: UnknownRecord;
}

export function parseFrame(raw: string): UnknownRecord | undefined {
	const trimmed = raw.trim();
	if (!trimmed.startsWith("{")) return undefined;
	try {
		return asRecord(JSON.parse(trimmed));
	} catch {
		return undefined;
	}
}

function requestId(frame: UnknownRecord): string | undefined {
	const id = frame.id;
	if (typeof id === "string") return id;
	return typeof id === "number" ? String(id) : undefined;
}

export function classifyFrames(records: readonly FrameRecord[]): ClassifiedFrame[] {
	const asked = new Map<string, string>();
	const out: ClassifiedFrame[] = [];
	for (const record of records) {
		const frame = parseFrame(record.raw);
		if (frame === undefined) continue;
		const method = asString(frame.method);
		const id = requestId(frame);
		if (method !== undefined) {
			if (id === undefined) {
				out.push({ direction: record.direction, kind: "notification", method, frame });
				continue;
			}
			asked.set(`${record.direction}:${id}`, method);
			out.push({ direction: record.direction, kind: "request", method, frame });
			continue;
		}
		const answers =
			id === undefined ? undefined : `${record.direction === "in" ? "out" : "in"}:${id}`;
		out.push({
			direction: record.direction,
			kind: "response",
			method: answers === undefined ? undefined : asked.get(answers),
			frame,
		});
	}
	return out;
}
