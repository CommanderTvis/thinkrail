import type { InitializeResponse } from "@agentclientprotocol/sdk";
import type {
	AgentAuthMethod,
	AgentDescriptor,
	CapabilitySource,
	ChatCapabilities,
	ChatCapabilityFlags,
	ConfigOption,
} from "@thinkrail/contracts";
import type { ThinkRailExtensionId } from "../meta";
import { readThinkRailMeta } from "../meta";
import {
	asArray,
	asBoolean,
	asFilledString,
	asRecord,
	asString,
	asStringArray,
	asStringRecord,
	assertNever,
} from "../translate/guards";
import type { AgentProfile } from "./profile";

export interface NegotiateInput {
	agent: AgentDescriptor;
	initialize: InitializeResponse;
	profile?: AgentProfile;
	mcpTools?: ChatCapabilityFlags["mcpTools"];
}

function has(extensions: readonly ThinkRailExtensionId[], id: ThinkRailExtensionId): boolean {
	return extensions.includes(id);
}

export function negotiateCapabilities(input: NegotiateInput): ChatCapabilities {
	const initialize = asRecord(input.initialize) ?? {};
	const agentCaps = asRecord(initialize.agentCapabilities) ?? {};
	const prompt = asRecord(agentCaps.promptCapabilities) ?? {};
	const sessions = asRecord(agentCaps.sessionCapabilities) ?? {};
	const mcp = asRecord(agentCaps.mcpCapabilities) ?? {};
	const auth = asRecord(agentCaps.auth) ?? {};
	const extensions = readThinkRailMeta(asRecord(initialize._meta))?.extensions ?? [];
	const profile = input.profile;
	const derivedFrom: Partial<Record<keyof ChatCapabilityFlags, CapabilitySource>> = {};

	const from = <K extends keyof ChatCapabilityFlags>(
		key: K,
		source: CapabilitySource,
		value: ChatCapabilityFlags[K],
	): ChatCapabilityFlags[K] => {
		derivedFrom[key] = source;
		return value;
	};

	const flags: ChatCapabilityFlags = {
		imageInput: from("imageInput", "agent", asBoolean(prompt.image) === true),
		embeddedContext: from("embeddedContext", "agent", asBoolean(prompt.embeddedContext) === true),
		steering: from(
			"steering",
			has(extensions, "steering") ? "meta" : "host",
			has(extensions, "steering") ? "native" : "queued",
		),
		followUp: from("followUp", "host", true),
		slashCommands: from("slashCommands", "registry", profile?.publishesCommands === true),
		promptTemplates: from("promptTemplates", "host", true),

		modelPicker: from("modelPicker", "registry", profile?.publishesModels === true),
		thinkingLevel: from("thinkingLevel", "registry", profile?.publishesThinkingLevels === true),
		modes: from("modes", "registry", profile?.publishesModes === true),
		configRefresh: from("configRefresh", "host", false),

		cost: from("cost", "registry", profile?.publishesUsage === true),
		tokenBreakdown: from("tokenBreakdown", "registry", profile?.publishesUsage === true),
		contextWindow: from("contextWindow", "registry", profile?.publishesUsage === true),

		plan: from("plan", "registry", profile?.publishesPlans === true ? "agent" : "thinkrail"),
		elicitation: from("elicitation", "host", true),
		permissions: from("permissions", "host", true),
		skills: from("skills", "meta", has(extensions, "skills")),
		workflowSkills: from("workflowSkills", "registry", profile?.workflowSkills === true),
		mcpTools: from("mcpTools", "host", input.mcpTools ?? resolveMcpTools(profile, mcp)),
		fileDelegation: from("fileDelegation", "host", true),
		terminalDelegation: from("terminalDelegation", "host", true),

		sessionList: from("sessionList", "agent", sessions.list != null),
		sessionLoad: from("sessionLoad", "agent", asBoolean(agentCaps.loadSession) === true),
		sessionFork: from("sessionFork", "agent", sessions.fork != null),
		sessionClose: from("sessionClose", "agent", sessions.close != null),

		retryVisibility: from("retryVisibility", "meta", has(extensions, "retry")),
		compactionVisibility: from("compactionVisibility", "meta", has(extensions, "compaction")),
		queueDepth: from("queueDepth", "meta", has(extensions, "queue")),

		authentication: from("authentication", "agent", authMethods(initialize.authMethods).length > 0),
		logout: from("logout", "agent", auth.logout != null),
		providerConfig: from("providerConfig", "agent", agentCaps.providers != null),
		jetbrainsCentral: from("jetbrainsCentral", "registry", profile?.jetbrainsCentral === true),
	};

	return { ...flags, agent: input.agent, derivedFrom };
}

function resolveMcpTools(
	profile: AgentProfile | undefined,
	mcp: { readonly [key: string]: unknown },
): ChatCapabilityFlags["mcpTools"] {
	if (profile?.mcpTools !== undefined) return profile.mcpTools;
	if (asBoolean(mcp.acp) === true) return "acp";
	if (asBoolean(mcp.http) === true) return "http";
	return "none";
}

export function authMethods(value: unknown): AgentAuthMethod[] {
	const out: AgentAuthMethod[] = [];
	for (const entry of asArray(value)) {
		const raw = asRecord(entry);
		if (raw === undefined) continue;
		const id = asFilledString(raw.id);
		const name = asString(raw.name);
		if (id === undefined || name === undefined) continue;
		const description = asFilledString(raw.description);
		const link = asFilledString(raw.link);
		const kind = raw.type === "env_var" ? "envVar" : raw.type === "terminal" ? "terminal" : "agent";
		const envVars = authEnvVars(raw.vars);
		const terminalArgs = kind === "terminal" ? asStringArray(raw.args) : undefined;
		const terminalEnv = kind === "terminal" ? asStringRecord(raw.env) : undefined;
		out.push({
			id,
			name,
			kind,
			...(description !== undefined ? { description } : {}),
			...(link !== undefined ? { link } : {}),
			...(envVars.length > 0 ? { envVars } : {}),
			...(terminalArgs !== undefined && terminalArgs.length > 0 ? { terminalArgs } : {}),
			...(terminalEnv !== undefined && Object.keys(terminalEnv).length > 0 ? { terminalEnv } : {}),
		});
	}
	return out;
}

function authEnvVars(value: unknown): NonNullable<AgentAuthMethod["envVars"]> {
	const out: NonNullable<AgentAuthMethod["envVars"]> = [];
	for (const entry of asArray(value)) {
		const raw = asRecord(entry);
		const name = raw === undefined ? undefined : asFilledString(raw.name);
		if (raw === undefined || name === undefined) continue;
		const label = asFilledString(raw.label);
		const secret = asBoolean(raw.secret);
		const optional = asBoolean(raw.optional);
		out.push({
			name,
			...(label !== undefined ? { label } : {}),
			...(secret !== undefined ? { secret } : {}),
			...(optional !== undefined ? { optional } : {}),
		});
	}
	return out;
}

export type CapabilityObservation =
	| { kind: "plan" }
	| { kind: "commands" }
	| { kind: "usage"; cost: boolean; tokens: boolean; context: boolean }
	| { kind: "configOptions"; options: readonly ConfigOption[] };

export function observeCapabilities(
	current: ChatCapabilities,
	observation: CapabilityObservation,
): ChatCapabilities | undefined {
	const next: ChatCapabilities = { ...current, derivedFrom: { ...current.derivedFrom } };
	let changed = false;
	const raise = (key: keyof ChatCapabilityFlags, value: boolean | string): void => {
		if (next[key] === value) return;
		Object.assign(next, { [key]: value });
		next.derivedFrom[key] = "observed";
		changed = true;
	};

	switch (observation.kind) {
		case "plan":
			if (next.plan !== "agent") raise("plan", "agent");
			break;
		case "commands":
			if (!next.slashCommands) raise("slashCommands", true);
			break;
		case "usage":
			if (observation.cost && !next.cost) raise("cost", true);
			if (observation.tokens && !next.tokenBreakdown) raise("tokenBreakdown", true);
			if (observation.context && !next.contextWindow) raise("contextWindow", true);
			break;
		case "configOptions": {
			const seen = new Set(observation.options.map((option) => option.category));
			if (seen.has("model") && !next.modelPicker) raise("modelPicker", true);
			if (seen.has("thinkingLevel") && !next.thinkingLevel) raise("thinkingLevel", true);
			if (seen.has("mode") && !next.modes) raise("modes", true);
			break;
		}
		default:
			assertNever(observation);
	}

	return changed ? next : undefined;
}
