export { forgetAgent, readAgentCatalog, recordAgent } from "./catalog";
export type { DetectAgentsOptions, DetectionProbe, DetectionQuery } from "./detect";
export { DETECTION_SHORTLIST, detectAgents, systemProbe } from "./detect";
export type { FetchLike, RegistryFetchResult } from "./fetch";
export { fetchRegistry, parseRegistryDocument, platformCandidates } from "./fetch";
export { markInstalled, planInstall } from "./resolve";
export type { AgentCatalogEntry, InstallDownload, InstallPlan } from "./types";
export { ACP_REGISTRY_URL } from "./types";
