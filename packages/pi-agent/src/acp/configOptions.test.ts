import { expect, test } from "bun:test";
import type { EngineModel } from "../engine";
import {
	configOptionsFor,
	isThinkingLevel,
	MODEL_OPTION_ID,
	modelValueId,
	parseModelValueId,
	THINKING_OPTION_ID,
} from "./configOptions";

const opus: EngineModel = {
	id: "claude-opus-4-5",
	name: "Claude Opus 4.5",
	provider: "anthropic",
	contextWindow: 200_000,
	reasoning: true,
	thinkingLevels: ["off", "low", "medium", "high"],
};

const flat: EngineModel = {
	id: "gpt-4.1",
	name: "GPT-4.1",
	provider: "openai",
	contextWindow: 1_000_000,
	reasoning: false,
	thinkingLevels: ["off"],
};

test("a model value id round-trips a provider whose model id contains slashes", () => {
	const ref = { provider: "openrouter", id: "anthropic/claude-opus-4-5" };
	expect(parseModelValueId(modelValueId(ref))).toEqual(ref);
});

test("a value id without a usable split is refused rather than guessed", () => {
	expect(parseModelValueId("anthropic")).toBeUndefined();
	expect(parseModelValueId("/claude")).toBeUndefined();
	expect(parseModelValueId("anthropic/")).toBeUndefined();
});

test("models become one model-category select grouped by provider", () => {
	const [model] = configOptionsFor([opus, flat], opus, "medium");
	expect(model).toMatchObject({
		id: MODEL_OPTION_ID,
		category: "model",
		type: "select",
		currentValue: "anthropic/claude-opus-4-5",
	});
	const groups =
		model?.type === "select"
			? model.options.map((entry) => ("group" in entry ? entry.group : entry.value))
			: [];
	expect(groups).toEqual(["anthropic", "openai"]);
});

test("the thinking select is absent when the current model has a single level", () => {
	expect(configOptionsFor([opus, flat], flat, "off").map((option) => option.id)).toEqual([
		MODEL_OPTION_ID,
	]);
	expect(configOptionsFor([opus, flat], opus, "high").map((option) => option.id)).toEqual([
		MODEL_OPTION_ID,
		THINKING_OPTION_ID,
	]);
});

test("a thinking level is accepted only when the model declares it", () => {
	expect(isThinkingLevel("high", opus.thinkingLevels)).toBe(true);
	expect(isThinkingLevel("high", flat.thinkingLevels)).toBe(false);
});
