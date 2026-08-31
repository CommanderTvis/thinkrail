import type { ProviderInfo, SetProviderRequest } from "@agentclientprotocol/sdk";
import type { AgentProviderInfo } from "@thinkrail/contracts";
import { asArray, asFilledString, asRecord, asStringArray } from "./guards";

export function toAgentProviders(
	providers: readonly ProviderInfo[] | null | undefined,
): AgentProviderInfo[] {
	const out: AgentProviderInfo[] = [];
	for (const entry of asArray(providers)) {
		const raw = asRecord(entry);
		if (raw === undefined) continue;
		const id = asFilledString(raw.providerId);
		if (id === undefined) continue;
		const current = asRecord(raw.current);
		const baseUrl = current === undefined ? undefined : asFilledString(current.baseUrl);
		out.push({
			id,
			required: raw.required === true,
			configured: current !== undefined,
			protocols: asStringArray(raw.supported) ?? [],
			...(baseUrl !== undefined ? { baseUrl } : {}),
		});
	}
	return out;
}

export function toSetProviderRequest(routing: {
	providerId: string;
	apiType: string;
	baseUrl: string;
	headers?: Record<string, string>;
}): SetProviderRequest {
	return {
		providerId: routing.providerId,
		apiType: routing.apiType,
		baseUrl: routing.baseUrl,
		...(routing.headers !== undefined ? { headers: routing.headers } : {}),
	};
}
