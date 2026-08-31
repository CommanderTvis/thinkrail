export { connectAgent } from "./connect";
export {
	AcpAuthRequiredError,
	AcpConnectionClosedError,
	AcpSpawnError,
	AcpVersionError,
} from "./errors";
export { spawnWithBun } from "./spawn";
export type {
	AgentConnection,
	AgentExit,
	AgentLaunchSpec,
	ConnectAgentOptions,
	LoadSessionInput,
	McpServerOffer,
	NewSessionInput,
	ProcessSpawner,
	PromptInput,
	SessionHandle,
	SpawnedProcess,
} from "./types";
