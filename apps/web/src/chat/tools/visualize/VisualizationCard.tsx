import type { ToolRenderProps } from "@/chat/toolRegistry";
import { resultText, strArg } from "@/chat/tools/toolHelpers";
import { ComparisonCard } from "@/chat/tools/visualize/ComparisonCard";
import { DiagramCard } from "@/chat/tools/visualize/DiagramCard";

export function VisualizationCard(props: ToolRenderProps) {
	const { args, result, status, interactive } = props;

	if (status === "error") {
		return (
			<div data-testid="tool-visualize" data-status="error" className="flex flex-col gap-4">
				<pre className="overflow-auto px-8 py-4 text-feedback-error tr-code-text">
					{resultText(result) || "Visualization failed."}
				</pre>
			</div>
		);
	}

	const type = strArg(args, "type");
	// A comparison has no mermaid to fail on, so its verdict is settled the moment it is shown.
	if (type === "comparison") props.onRender?.(null);
	return (
		<div
			data-testid="tool-visualize"
			data-status={status}
			className={interactive ? "flex h-full min-h-0 flex-col" : undefined}
		>
			{type === "comparison" ? <ComparisonCard {...props} /> : <DiagramCard {...props} />}
		</div>
	);
}
