import type { AgentPlan, ChatCapabilities, ChatMessage, ConfigOption } from "@thinkrail/contracts";

export interface HydratedRuntime {
	messages: ChatMessage[];
	configOptions: ConfigOption[];
	capabilities: ChatCapabilities;
	plan: AgentPlan | null;
}

export function hydrateRuntime(
	messages: ChatMessage[],
	configOptions: ConfigOption[],
	capabilities: ChatCapabilities,
	plan: AgentPlan | null,
): HydratedRuntime {
	return { messages, configOptions, capabilities, plan };
}
