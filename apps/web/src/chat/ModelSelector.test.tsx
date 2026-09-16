import { expect, test } from "bun:test";
import type { WireModel } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelSelector } from "./ModelSelector";

const mockModel = (id: string, name: string, provider = "openai"): WireModel => ({
	id,
	name,
	provider,
	contextWindow: 128000,
	maxTokens: 4096,
	reasoning: false,
	thinkingLevels: [],
});

test("ModelSelector renders the trigger button with current model", () => {
	const current = mockModel("gpt-4o", "GPT-4o");
	const markup = renderToStaticMarkup(
		<ModelSelector
			models={[current, mockModel("gpt-4-0314", "GPT-4 (0314)")]}
			current={current}
			onSelect={() => {}}
			refreshing={false}
			onRefresh={() => {}}
		/>,
	);
	expect(markup).toContain('data-testid="model-selector"');
	expect(markup).toContain("GPT-4o");
});

test("ModelSelector renders placeholder when no model is selected", () => {
	const markup = renderToStaticMarkup(
		<ModelSelector
			models={[mockModel("gpt-4o", "GPT-4o")]}
			current={null}
			placeholder="Automatic (provider default)"
			onSelect={() => {}}
			refreshing={false}
			onRefresh={() => {}}
		/>,
	);
	expect(markup).toContain('data-testid="model-selector"');
	expect(markup).toContain("Automatic (provider default)");
});
