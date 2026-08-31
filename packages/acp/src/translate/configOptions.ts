import type {
	SessionConfigOption,
	SessionConfigOptionCategory,
	SetSessionConfigOptionRequest,
} from "@agentclientprotocol/sdk";
import type {
	ConfigChoice,
	ConfigOption,
	ConfigOptionCategory,
	ConfigOptionGroup,
	ConfigValue,
} from "@thinkrail/contracts";
import type { DeclaredVariants } from "./guards";
import { asArray, asFilledString, asRecord, asString, isVariant } from "./guards";

export const CONFIG_OPTION_CATEGORIES = {
	model: "model",
	model_config: "modelConfig",
	thought_level: "thinkingLevel",
	mode: "mode",
} as const satisfies DeclaredVariants<SessionConfigOptionCategory>;

export function toConfigOptions(
	options: readonly SessionConfigOption[] | null | undefined,
): ConfigOption[] {
	const out: ConfigOption[] = [];
	for (const entry of asArray(options)) {
		const raw = asRecord(entry);
		if (raw === undefined) continue;
		const id = asFilledString(raw.id);
		const name = asString(raw.name);
		if (id === undefined || name === undefined) continue;
		const description = asFilledString(raw.description);
		const categoryKey = raw.category;
		const category: ConfigOptionCategory = isVariant(categoryKey, CONFIG_OPTION_CATEGORIES)
			? CONFIG_OPTION_CATEGORIES[categoryKey]
			: "other";
		const base = {
			id,
			name,
			category,
			...(description !== undefined ? { description } : {}),
		};

		if (raw.type === "boolean") {
			out.push({ ...base, control: { type: "toggle", value: raw.currentValue === true } });
			continue;
		}
		if (raw.type !== "select") continue;
		out.push({
			...base,
			control: {
				type: "select",
				value: asString(raw.currentValue) ?? "",
				groups: toGroups(raw.options),
			},
		});
	}
	return out;
}

function toGroups(options: unknown): ConfigOptionGroup[] {
	const flat: ConfigChoice[] = [];
	const groups: ConfigOptionGroup[] = [];
	for (const entry of asArray(options)) {
		const raw = asRecord(entry);
		if (raw === undefined) continue;
		const groupId = asFilledString(raw.group);
		if (groupId !== undefined && Array.isArray(raw.options)) {
			const choices = toChoices(raw.options);
			if (choices.length > 0) {
				groups.push({ id: groupId, name: asString(raw.name) ?? groupId, choices });
			}
			continue;
		}
		const choice = toChoice(raw);
		if (choice !== undefined) flat.push(choice);
	}
	if (flat.length > 0) groups.unshift({ id: "", name: null, choices: flat });
	return groups;
}

function toChoices(options: unknown): ConfigChoice[] {
	const out: ConfigChoice[] = [];
	for (const entry of asArray(options)) {
		const choice = toChoice(asRecord(entry));
		if (choice !== undefined) out.push(choice);
	}
	return out;
}

function toChoice(raw: ReturnType<typeof asRecord>): ConfigChoice | undefined {
	if (raw === undefined) return undefined;
	const id = asString(raw.value);
	if (id === undefined) return undefined;
	const description = asFilledString(raw.description);
	return {
		id,
		name: asString(raw.name) ?? id,
		...(description !== undefined ? { description } : {}),
	};
}

export function toSetConfigOptionRequest(input: {
	sessionId: string;
	optionId: string;
	value: ConfigValue;
}): SetSessionConfigOptionRequest {
	if (typeof input.value === "boolean") {
		return {
			sessionId: input.sessionId,
			configId: input.optionId,
			type: "boolean",
			value: input.value,
		};
	}
	return { sessionId: input.sessionId, configId: input.optionId, value: input.value };
}

export function hasCategory(
	options: readonly ConfigOption[],
	category: ConfigOptionCategory,
): boolean {
	return options.some((option) => option.category === category);
}
