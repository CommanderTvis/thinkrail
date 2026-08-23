import type { ClaudeEdit } from "@thinkrail/contracts";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { abbreviateHomePath } from "../lib";
import { useAppStore } from "../store";
import { openFileInTab } from "./openTabs";

const SCOPE_STYLES: Record<string, string> = {
	managed: "bg-container-elevated-bg text-text-muted",
	local: "bg-feedback-error-subtle text-feedback-error",
	project: "bg-feedback-warning-subtle text-feedback-warning",
	user: "bg-feedback-info-subtle text-feedback-info",
	default: "bg-container-elevated-bg text-text-subtle",
};

export function ScopeChip({ scope }: { scope: string }) {
	return (
		<span
			data-testid="claude-scope-chip"
			data-scope={scope}
			className={`shrink-0 rounded-[var(--radius-sm)] px-4 tr-text-label-pill uppercase ${
				SCOPE_STYLES[scope] ?? SCOPE_STYLES.default
			}`}
		>
			{scope}
		</span>
	);
}

export type OpenSource = (path: string, keyPath?: readonly string[]) => void;

export type EditRequest = (pending: { edit: ClaudeEdit; title: string }) => void;

export function useOpenSource(workspaceId: string): OpenSource {
	return useCallback(
		(path: string, keyPath?: readonly string[]) => {
			if (keyPath && keyPath.length > 0) {
				useAppStore.getState().requestFileFocus(workspaceId, path, keyPath);
			}
			void openFileInTab(workspaceId, path, "keep").catch(() => {});
		},
		[workspaceId],
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
		<button
			type="button"
			data-testid="claude-open-source"
			title={path}
			onClick={() => onOpen(path, keyPath)}
			className="min-w-0 truncate text-left tr-code-text text-text-muted hover:text-primary hover:underline"
		>
			{abbreviateHomePath(path)}
		</button>
	);
}

export function RowAction({
	testid,
	label,
	tone = "neutral",
	onClick,
}: {
	testid: string;
	label: string;
	tone?: "neutral" | "danger";
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			data-testid={testid}
			onClick={onClick}
			className={`shrink-0 rounded-[var(--radius-sm)] border border-border-default px-8 tr-text-label-pill uppercase hover:bg-control-bg-hovered ${
				tone === "danger"
					? "text-text-subtle hover:text-feedback-error"
					: "text-text-muted hover:text-text-default"
			}`}
		>
			{label}
		</button>
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
