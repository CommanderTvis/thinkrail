import type { ToolRenderProps } from "@/chat/toolRegistry";
import { strArg } from "@/chat/tools/toolHelpers";
import { MermaidView } from "@/chat/tools/visualize/MermaidView";

export function DiagramCard({ args, status, interactive = false, onRender }: ToolRenderProps) {
	const source = strArg(args, "mermaid");
	const title = strArg(args, "title");

	if (!source) {
		return (
			<span className="text-text-muted tr-text-metadata italic">
				{status === "running" ? "Rendering…" : "(no diagram)"}
			</span>
		);
	}
	if (interactive) {
		return (
			<div data-testid="tool-visualize-diagram" className="flex h-full min-h-0 flex-col">
				<MermaidView
					source={source}
					title={title}
					interactive
					{...(onRender ? { onRender } : {})}
				/>
			</div>
		);
	}
	return (
		<div data-testid="tool-visualize-diagram" className="flex flex-col gap-4">
			{title ? <div className="tr-title-compact text-text-default">{title}</div> : null}
			<MermaidView source={source} title={title} />
		</div>
	);
}
