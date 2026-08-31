import type { AgentOrigin } from "@thinkrail/contracts";
import type { AgentLaunchSpec } from "../connection";

export const ACP_REGISTRY_URL =
	"https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

export interface AgentCatalogEntry {
	id: string;
	name: string;
	version?: string;
	icon?: string;
	origin: AgentOrigin;
	launch: AgentLaunchSpec;
	dir?: string;
}

export interface InstallDownload {
	url: string;
	sha256?: string;
	dir: string;
}

export interface InstallPlan {
	download: InstallDownload | null;
	entry: AgentCatalogEntry;
}
