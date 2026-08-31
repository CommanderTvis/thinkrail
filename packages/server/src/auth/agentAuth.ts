import { profileFor } from "@thinkrail/acp";
import type {
	AgentAuthMethod,
	AgentAuthResult,
	AgentProviderInfo,
	AgentProvidersReport,
} from "@thinkrail/contracts";
import { jbcentralInstall } from "@thinkrail/shared/jbcentral";
import { getJbcentralStatus, isJbcentralUsable } from "./jbcentral";

export interface ProviderRouting {
	providerId: string;
	apiType: string;
	baseUrl: string;
	headers?: Record<string, string>;
}

export interface AgentCredentials {
	authMethods(): Promise<AgentAuthMethod[]>;
	authenticate(input: { methodId: string; env?: Record<string, string> }): Promise<AgentAuthResult>;
	logout(methodId?: string): Promise<void>;
	listProviders(): Promise<AgentProviderInfo[]>;
	setProvider(routing: ProviderRouting): Promise<void>;
	disableProvider(providerId: string): Promise<void>;
}

export type AgentCredentialsResolver = (agentId: string) => Promise<AgentCredentials>;

let resolver: AgentCredentialsResolver | null = null;

export function setAgentCredentials(resolve: AgentCredentialsResolver | null): void {
	resolver = resolve;
}

function reach(agentId: string): Promise<AgentCredentials> {
	if (resolver === null) {
		return Promise.reject(new Error(`No agent named "${agentId}" is reachable.`));
	}
	return resolver(agentId);
}

async function readOr<T>(
	agentId: string,
	read: (credentials: AgentCredentials) => Promise<T>,
	absent: T,
): Promise<T> {
	try {
		return await read(await reach(agentId));
	} catch {
		return absent;
	}
}

function describeFailure(error: unknown): string {
	if (error instanceof Error && error.message.length > 0) return error.message;
	return "Authentication failed.";
}

export function agentAuthMethods(agentId: string): Promise<AgentAuthMethod[]> {
	return readOr(agentId, (credentials) => credentials.authMethods(), []);
}

export async function authenticateAgent(input: {
	agentId: string;
	methodId: string;
	env?: Record<string, string>;
}): Promise<AgentAuthResult> {
	try {
		const credentials = await reach(input.agentId);
		return await credentials.authenticate({
			methodId: input.methodId,
			...(input.env === undefined ? {} : { env: input.env }),
		});
	} catch (error) {
		return { outcome: "failed", error: describeFailure(error) };
	}
}

export async function logoutAgent(agentId: string, methodId?: string): Promise<void> {
	const credentials = await reach(agentId);
	await credentials.logout(methodId);
}

export async function agentProviders(agentId: string): Promise<AgentProvidersReport> {
	const providers = await readOr<AgentProviderInfo[]>(
		agentId,
		(credentials) => credentials.listProviders(),
		[],
	);
	const anyProviderConfigured = providers.some((provider) => provider.configured);
	if (profileFor(agentId)?.jetbrainsCentral !== true) {
		return { providers, anyConfigured: anyProviderConfigured };
	}
	const jbcentral = await getJbcentralStatus();
	return {
		providers,
		jbcentral,
		jbcentralInstall: jbcentralInstall(process.platform),
		anyConfigured: anyProviderConfigured || isJbcentralUsable(jbcentral),
	};
}

export async function setAgentProvider(agentId: string, routing: ProviderRouting): Promise<void> {
	const credentials = await reach(agentId);
	await credentials.setProvider({
		providerId: routing.providerId,
		apiType: routing.apiType,
		baseUrl: routing.baseUrl,
		...(routing.headers === undefined ? {} : { headers: routing.headers }),
	});
}

export async function disableAgentProvider(agentId: string, providerId: string): Promise<void> {
	const credentials = await reach(agentId);
	const listed = await credentials.listProviders();
	if (listed.some((provider) => provider.id === providerId && provider.required)) {
		throw new Error(`Provider "${providerId}" is required by this agent and cannot be disabled.`);
	}
	await credentials.disableProvider(providerId);
}
