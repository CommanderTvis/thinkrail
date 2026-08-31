import type { SessionConfigOption, SessionConfigSelectGroup } from "@agentclientprotocol/sdk";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { EngineModel } from "../engine";

export const MODEL_OPTION_ID = "model";
export const THINKING_OPTION_ID = "thinkingLevel";

const THINKING_NAMES: { readonly [level: string]: string } = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
};

export function modelValueId(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

export function parseModelValueId(value: string): { provider: string; id: string } | undefined {
	const cut = value.indexOf("/");
	if (cut <= 0 || cut === value.length - 1) return undefined;
	return { provider: value.slice(0, cut), id: value.slice(cut + 1) };
}

function modelGroups(models: readonly EngineModel[]): SessionConfigSelectGroup[] {
	const byProvider = new Map<string, SessionConfigSelectGroup>();
	for (const model of models) {
		const group = byProvider.get(model.provider) ?? {
			group: model.provider,
			name: model.provider,
			options: [],
		};
		group.options.push({
			value: modelValueId(model),
			name: model.name,
			_meta: { contextWindow: model.contextWindow, reasoning: model.reasoning },
		});
		byProvider.set(model.provider, group);
	}
	return [...byProvider.values()];
}

export function configOptionsFor(
	models: readonly EngineModel[],
	current: EngineModel | null,
	thinkingLevel: ThinkingLevel,
): SessionConfigOption[] {
	const levels = current?.thinkingLevels ?? [];
	const options: SessionConfigOption[] = [
		{
			id: MODEL_OPTION_ID,
			name: "Model",
			category: "model",
			type: "select",
			currentValue: current ? modelValueId(current) : "",
			options: modelGroups(models),
		},
	];
	if (levels.length > 1) {
		options.push({
			id: THINKING_OPTION_ID,
			name: "Thinking",
			category: "thought_level",
			type: "select",
			currentValue: thinkingLevel,
			options: levels.map((level) => ({
				value: level,
				name: THINKING_NAMES[level] ?? level,
			})),
		});
	}
	return options;
}

export function isThinkingLevel(
	value: string,
	levels: readonly ThinkingLevel[],
): value is ThinkingLevel {
	return (levels as readonly string[]).includes(value);
}
