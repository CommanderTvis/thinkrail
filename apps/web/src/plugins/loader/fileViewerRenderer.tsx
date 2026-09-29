import type { FileViewerRegistration } from "@thinkrail/plugin-api/web";
import { useState } from "react";
import type { ResourceRenderer, ResourceViewProps } from "@/resources";

/** A plugin viewer outranks every bundled renderer for the files it claims; Source stays one toggle away. */
const PLUGIN_VIEWER_RANK = 200;

function contentStamp(content: ResourceViewProps["content"]): string {
	return content.kind === "absent" ? "" : content.hash;
}

function useRevision(stamp: string): number {
	const [seen, setSeen] = useState({ stamp, revision: 0 });
	if (seen.stamp !== stamp) setSeen({ stamp, revision: seen.revision + 1 });
	return seen.stamp === stamp ? seen.revision : seen.revision + 1;
}

export function pluginFileViewerRenderer(
	pluginId: string,
	label: string,
	declared: ReadonlyArray<{ extensions: readonly string[]; names: readonly string[] }>,
	registration: FileViewerRegistration,
): ResourceRenderer {
	const Viewer = registration.component;
	function PluginFileView({ resource, content }: ResourceViewProps) {
		const revision = useRevision(contentStamp(content));
		return <Viewer workspaceId={resource.workspaceId} path={resource.path} revision={revision} />;
	}
	return {
		id: `plugin/${pluginId}`,
		label,
		match: registration.matches
			? { test: registration.matches }
			: {
					glob: declared.flatMap((viewer) => [
						...viewer.extensions.map((extension) => `*.${extension}`),
						...viewer.names,
					]),
				},
		rank: PLUGIN_VIEWER_RANK,
		capabilities: {
			view: true,
			diff: false,
			anchors: { view: [], diff: [] },
			mobile: true,
			copy: false,
			layout: false,
			whitespace: false,
		},
		loadView: () => Promise.resolve({ default: PluginFileView }),
	};
}
