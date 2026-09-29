import type { ComponentType } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { QuietScrollArea } from "../components/QuietScrollArea";
import { selectSideTool, usePluginRegistry } from "../plugins/registry";

export function PluginToolBody({
	tool,
	workspaceId,
	label,
	icon: Icon,
	dormant,
}: {
	tool: string;
	workspaceId: string;
	label: string;
	icon: ComponentType<{ className?: string | undefined }>;
	dormant: boolean;
}) {
	const registration = usePluginRegistry((state) => selectSideTool(state, tool));
	if (dormant || !registration) {
		return (
			<div
				data-testid="plugin-tool-dormant"
				className="flex h-full flex-col items-center justify-center gap-8 px-16 text-center tr-text-ui text-text-muted"
			>
				<Icon className="size-24" />
				<p>{label} is off</p>
				<p className="tr-text-metadata text-text-subtle">Turn it on in Settings › Plugins.</p>
			</div>
		);
	}
	const Component = registration.component;
	return (
		<ErrorBoundary label={label} resetKeys={[tool]}>
			<QuietScrollArea className="h-full" viewportClassName="p-12">
				<Component key={tool} workspaceId={workspaceId} />
			</QuietScrollArea>
		</ErrorBoundary>
	);
}
