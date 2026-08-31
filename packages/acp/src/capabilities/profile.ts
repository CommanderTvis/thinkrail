export interface AgentProfile {
	id: string;
	publishesPlans?: boolean;
	publishesCommands?: boolean;
	publishesUsage?: boolean;
	publishesModels?: boolean;
	publishesThinkingLevels?: boolean;
	publishesModes?: boolean;
	mcpTools?: "native" | "acp" | "http" | "none";
	jetbrainsCentral?: boolean;
	workflowSkills?: boolean;
	notes?: string;
}

export const BUNDLED_AGENT_PROFILES: readonly AgentProfile[] = [
	{
		id: "thinkrail-pi",
		publishesPlans: false,
		publishesCommands: true,
		publishesUsage: true,
		publishesModels: true,
		publishesThinkingLevels: true,
		publishesModes: false,
		mcpTools: "native",
		jetbrainsCentral: true,
		workflowSkills: true,
		notes: "ThinkRail's first-party pi agent: tools registered natively, no MCP hop.",
	},
	{
		id: "junie",
		publishesCommands: true,
		publishesUsage: true,
		publishesModels: true,
		notes: "JetBrains Junie, from the ACP registry.",
	},
];

export function profileFor(agentId: string): AgentProfile | undefined {
	return BUNDLED_AGENT_PROFILES.find((profile) => profile.id === agentId);
}
