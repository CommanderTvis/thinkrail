import type { FileViewerProps, PluginWebContext } from "@thinkrail/plugin-api/web";
import { Button } from "@thinkrail/plugin-ui";
import type { blueprintContract } from "../contracts";

/**
 * What a rehydrated `BLUEPRINT.md` tab shows: the manifest declares `read: "none"`, so a restored tab
 * never re-reads text — this is that placeholder, with the one way back to the real file. See SPEC.md.
 */
export function createBlueprintRawHint(ctx: PluginWebContext<typeof blueprintContract>) {
	return function BlueprintRawHint({ workspaceId, path }: FileViewerProps) {
		return (
			<div
				data-testid="blueprint-raw-hint"
				className="flex h-full flex-col items-center justify-center gap-8 px-16 text-center"
			>
				<p className="text-text-muted">This file is a blueprint's interactive specification.</p>
				<Button
					variant="outline"
					size="sm"
					data-testid="blueprint-open-raw-source"
					onClick={() => void ctx.editors.open(workspaceId, path, { raw: true })}
				>
					Open raw source
				</Button>
			</div>
		);
	};
}
