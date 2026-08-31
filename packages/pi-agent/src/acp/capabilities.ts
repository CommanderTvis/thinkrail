import type {
	AgentCapabilities,
	ClientCapabilities,
	Implementation,
} from "@agentclientprotocol/sdk";
import type { ThinkRailExtensionId } from "@thinkrail/acp/meta";

export const PI_AGENT_INFO: Implementation = {
	name: "thinkrail-pi",
	title: "ThinkRail pi",
	version: "0.0.0",
};

export const PI_AGENT_CAPABILITIES: AgentCapabilities = {
	loadSession: true,
	promptCapabilities: { image: true, audio: false, embeddedContext: true },
	mcpCapabilities: { http: false, sse: false, acp: false },
	sessionCapabilities: { list: {}, delete: {}, close: {} },
	providers: {},
};

export const PI_AGENT_EXTENSIONS: readonly ThinkRailExtensionId[] = [
	"retry",
	"compaction",
	"queue",
	"steering",
];

export interface NegotiatedClient {
	readTextFile: boolean;
	writeTextFile: boolean;
	terminal: boolean;
	elicitation: boolean;
	configOptions: boolean;
}

export const OFFLINE_CLIENT: NegotiatedClient = {
	readTextFile: false,
	writeTextFile: false,
	terminal: false,
	elicitation: false,
	configOptions: false,
};

export function readClientCapabilities(
	capabilities: ClientCapabilities | undefined,
): NegotiatedClient {
	return {
		readTextFile: capabilities?.fs?.readTextFile === true,
		writeTextFile: capabilities?.fs?.writeTextFile === true,
		terminal: capabilities?.terminal === true,
		elicitation: capabilities?.elicitation != null,
		configOptions: capabilities?.session?.configOptions != null,
	};
}
