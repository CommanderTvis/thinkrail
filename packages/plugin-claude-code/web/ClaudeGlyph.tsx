import { RiRobot2Line } from "@remixicon/react";
import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import { cn, SvgAsset } from "@thinkrail/plugin-ui";
import type { claudeCodeContract } from "../contracts";

/** The Claude brand mark, drawn from this plugin's own `claude.svg` asset. See this package's SPEC.md. */
export function createClaudeGlyph(ctx: PluginWebContext<typeof claudeCodeContract>) {
	const url = ctx.assetUrl("claude.svg");
	return function ClaudeGlyph({ className }: { className?: string }) {
		const size = cn("size-14", className);
		return (
			<SvgAsset
				url={url}
				className={size}
				name="claude"
				fallback={<RiRobot2Line className={size} />}
			/>
		);
	};
}
