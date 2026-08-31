export type { AgentProfile, CapabilityObservation, NegotiateInput } from "./capabilities";
export {
	authMethods,
	BUNDLED_AGENT_PROFILES,
	negotiateCapabilities,
	observeCapabilities,
	profileFor,
	THINKRAIL_CLIENT_CAPABILITIES,
	THINKRAIL_CLIENT_INFO,
} from "./capabilities";
export type {
	AcpClientDelegates,
	McpEndpoint,
	TerminalCreateRequest,
	TerminalExit,
	TerminalOutput,
} from "./client";
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
} from "./connection";
export {
	AcpAuthRequiredError,
	AcpConnectionClosedError,
	AcpSpawnError,
	AcpVersionError,
	connectAgent,
} from "./connection";
export type {
	CompactionMeta,
	MetaBag,
	QueueMeta,
	RetryMeta,
	SteerMeta,
	ThinkRailExtensionId,
	ThinkRailExtMethod,
	ThinkRailMeta,
} from "./meta";
export {
	mergeThinkRailMeta,
	readThinkRailMeta,
	THINKRAIL_EXT_METHODS,
	THINKRAIL_EXTENSION_IDS,
	THINKRAIL_META_KEY,
	writeThinkRailMeta,
} from "./meta";
export type {
	AgentCatalogEntry,
	DetectAgentsOptions,
	DetectionProbe,
	DetectionQuery,
	FetchLike,
	InstallDownload,
	InstallPlan,
	RegistryFetchResult,
} from "./registry";
export {
	ACP_REGISTRY_URL,
	DETECTION_SHORTLIST,
	detectAgents,
	fetchRegistry,
	forgetAgent,
	markInstalled,
	parseRegistryDocument,
	planInstall,
	platformCandidates,
	readAgentCatalog,
	recordAgent,
	systemProbe,
} from "./registry";
