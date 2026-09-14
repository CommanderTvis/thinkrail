import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import { ScopeChip as SharedScopeChip, SourcePath } from "@thinkrail/plugin-ui";
import type { ReactNode } from "react";
import { useCallback } from "react";
import type { ClaudeEdit, claudeCodeContract } from "../contracts";

export function ScopeChip({ scope }: { scope: string }) {
	return <SharedScopeChip scope={scope} testId="claude-scope-chip" />;
}

export type OpenSource = (path: string, keyPath?: readonly string[]) => void;

export type EditRequest = (pending: { edit: ClaudeEdit; title: string }) => void;

export function useOpenSource(
	ctx: PluginWebContext<typeof claudeCodeContract>,
	workspaceId: string,
): OpenSource {
	return useCallback(
		(path: string, keyPath?: readonly string[]) => {
			void ctx.editors.open(workspaceId, path, keyPath ? { keyPath } : undefined).catch(() => {});
		},
		[ctx, workspaceId],
	);
}

export function SourceButton({
	path,
	keyPath,
	onOpen,
}: {
	path: string;
	keyPath?: readonly string[] | undefined;
	onOpen: OpenSource;
}) {
	return (
		<SourcePath
			path={path}
			testId="claude-open-source"
			onOpen={(opened) => onOpen(opened, keyPath)}
		/>
	);
}

/** One field shape for every compose dialog, so four forms cannot drift into four looks. */
export const FIELD_CLASS =
	"rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none placeholder:text-text-subtle focus:border-primary";

export function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-4">
			<span className="tr-text-metadata text-text-muted">{label}</span>
			{children}
			{hint ? <span className="tr-text-metadata text-text-subtle">{hint}</span> : null}
		</div>
	);
}

export function ComposeActions({
	testid,
	problem,
	onCancel,
	onSubmit,
}: {
	testid: string;
	problem: string | null;
	onCancel: () => void;
	onSubmit: () => void;
}) {
	return (
		<>
			{problem ? (
				<p data-testid={`${testid}-problem`} className="tr-text-metadata text-feedback-warning">
					{problem}
				</p>
			) : null}
			<div className="flex items-center justify-end gap-8">
				<button
					type="button"
					onClick={onCancel}
					className="rounded-[var(--radius-sm)] border border-border-default px-12 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
				>
					Cancel
				</button>
				<button
					type="button"
					data-testid={`${testid}-continue`}
					disabled={problem !== null}
					onClick={onSubmit}
					className="rounded-[var(--radius-sm)] bg-control-primary-bg px-12 py-4 tr-text-ui text-control-primary-text hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
				>
					Review the change
				</button>
			</div>
		</>
	);
}
