import { RiOpenaiLine } from "@remixicon/react";
import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import { SvgAsset } from "@thinkrail/plugin-ui";
import type { codexContract } from "../contracts";

/** The Codex mark, drawn from this plugin's own `codex.svg` asset. See this package's SPEC.md. */
export function createCodexGlyph(ctx: PluginWebContext<typeof codexContract>) {
	const url = ctx.assetUrl("codex.svg");
	return function CodexGlyph({ className }: { className?: string | undefined }) {
		return (
			<SvgAsset
				url={url}
				className={className}
				name="codex"
				fallback={<RiOpenaiLine className={className} />}
			/>
		);
	};
}

/** The mark a GPT model wears in a model list: OpenAI's, which Codex's own mark is not. */
export function GptGlyph({ className }: { className?: string }) {
	return <RiOpenaiLine className={className} />;
}
