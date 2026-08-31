import type {
	PermissionOption as AcpPermissionOption,
	PermissionOptionKind as AcpPermissionOptionKind,
	RequestPermissionOutcome,
	RequestPermissionRequest,
} from "@agentclientprotocol/sdk";
import type {
	PermissionDecision,
	PermissionOption,
	PermissionOptionKind,
	PermissionRequest,
} from "@thinkrail/contracts";
import { asArray, asFilledString, asRecord, isVariant } from "./guards";
import { synthesizeToolCall } from "./toolCall";

export const OPTION_KINDS: { readonly [K in AcpPermissionOptionKind]: PermissionOptionKind } = {
	allow_once: "allowOnce",
	allow_always: "allowAlways",
	reject_once: "rejectOnce",
	reject_always: "rejectAlways",
};

export function toPermissionOptions(
	options: readonly AcpPermissionOption[] | null | undefined,
): PermissionOption[] {
	const out: PermissionOption[] = [];
	for (const entry of asArray(options)) {
		const raw = asRecord(entry);
		const id = raw === undefined ? undefined : asFilledString(raw.optionId);
		if (raw === undefined || id === undefined) continue;
		const kind = raw.kind;
		out.push({
			id,
			name: asFilledString(raw.name) ?? id,
			kind: isVariant(kind, OPTION_KINDS) ? OPTION_KINDS[kind] : "rejectOnce",
		});
	}
	return out;
}

export function toPermissionRequest(
	request: RequestPermissionRequest,
	id: string,
): PermissionRequest {
	const call = synthesizeToolCall(request.toolCall);
	return {
		id,
		sessionId: request.sessionId,
		toolCallId: call.toolCallId,
		call,
		options: toPermissionOptions(request.options),
	};
}

export function toPermissionOutcome(decision: PermissionDecision): RequestPermissionOutcome {
	if (decision.outcome === "selected") {
		return { outcome: "selected", optionId: decision.optionId };
	}
	return { outcome: "cancelled" };
}
