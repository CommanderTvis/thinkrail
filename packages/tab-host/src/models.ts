import {
	type Api,
	type AuthPrompt,
	type Credential,
	type CredentialStore,
	getSupportedThinkingLevels,
	type Model,
	type MutableModels,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { LoginFrame, ProviderStatusReport, WireModel } from "@thinkrail/contracts";
import { JETBRAINS_AI_PROVIDER_ID, jetbrainsAiProvider } from "./jetbrains";

export interface CredentialFile {
	read(): Record<string, Credential>;
	write(next: Record<string, Credential>): void;
}

function credentialStore(file: CredentialFile): CredentialStore {
	return {
		read: async (providerId) => file.read()[providerId],
		list: async () =>
			Object.entries(file.read()).map(([providerId, credential]) => ({
				providerId,
				type: credential.type,
			})),
		modify: async (providerId, fn) => {
			const all = file.read();
			const next = await fn(all[providerId]);
			const { [providerId]: _previous, ...rest } = all;
			file.write(next === undefined ? rest : { ...rest, [providerId]: next });
			return next;
		},
		delete: async (providerId) => {
			const { [providerId]: _removed, ...rest } = file.read();
			file.write(rest);
		},
	};
}

const SESSION_ONLY_PROVIDERS = new Set([JETBRAINS_AI_PROVIDER_ID]);

/** Credentials of session-only providers live in this worker's memory and never reach the persisted file. */
export function sessionOnly(file: CredentialFile): CredentialFile {
	const memory: Record<string, Credential> = {};
	return {
		read: () => ({ ...file.read(), ...memory }),
		write: (next) => {
			const persisted: Record<string, Credential> = {};
			for (const [id, credential] of Object.entries(next)) {
				if (SESSION_ONLY_PROVIDERS.has(id)) memory[id] = credential;
				else persisted[id] = credential;
			}
			for (const id of SESSION_ONLY_PROVIDERS) if (!(id in next)) delete memory[id];
			file.write(persisted);
		},
	};
}

/** The tab's model catalog: pi-ai's builtin providers, credentials kept in the tab's own state. */
export function createTabModels(file: CredentialFile): MutableModels {
	const models = builtinModels({
		credentials: credentialStore(sessionOnly(file)),
		authContext: { env: async () => undefined, fileExists: async () => false },
	});
	const claude = models
		.getProvider("anthropic")
		?.getModels()
		.filter((model) => model.api === "anthropic-messages");
	if (claude) models.setProvider(jetbrainsAiProvider(claude as Model<"anthropic-messages">[]));
	return models;
}

export function toWireModel(model: Model<Api>): WireModel {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		contextWindow: model.contextWindow,
		reasoning: model.reasoning,
		thinkingLevels: getSupportedThinkingLevels(model),
		cost: { input: model.cost.input, output: model.cost.output },
		input: model.input,
		auth: { kind: "api-key" },
	};
}

export async function availableModels(models: MutableModels): Promise<WireModel[]> {
	return (await models.getAvailable()).map(toWireModel);
}

const LISTED_PROVIDERS = [
	JETBRAINS_AI_PROVIDER_ID,
	"anthropic",
	"openai",
	"google",
	"openrouter",
	"mistral",
	"groq",
	"xai",
	"deepseek",
];

export async function providerStatus(models: MutableModels): Promise<ProviderStatusReport> {
	const providers = [];
	for (const id of LISTED_PROVIDERS) {
		const provider = models.getProvider(id);
		if (!provider) continue;
		const check = await models.checkAuth(id).catch(() => undefined);
		providers.push({
			id,
			name: provider.name,
			configured: check !== undefined,
			...(check
				? { kind: check.type === "oauth" ? ("oauth" as const) : ("api-key" as const) }
				: {}),
			canApiKey: id !== JETBRAINS_AI_PROVIDER_ID,
			canOAuth: id === JETBRAINS_AI_PROVIDER_ID,
			canLogout: check !== undefined,
		});
	}
	return {
		providers,
		jbcentral: { state: "absent" },
		jbcentralInstall: { platform: "browser", shell: "bash", command: "" },
	};
}

export function frameForPrompt(prompt: AuthPrompt): LoginFrame {
	if (prompt.type === "select")
		return {
			kind: "select",
			message: prompt.message,
			options: prompt.options.map(({ id, label }) => ({ id, label })),
		};
	return {
		kind: "prompt",
		message: prompt.message,
		...(prompt.placeholder !== undefined ? { placeholder: prompt.placeholder } : {}),
		...(prompt.type === "secret" ? { secret: true } : {}),
	};
}
