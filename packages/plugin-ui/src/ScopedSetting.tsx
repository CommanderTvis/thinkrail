import { RiAddLine as Plus } from "@remixicon/react";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

const SCOPE_STYLES: Record<string, string> = {
	managed: "bg-container-elevated-bg text-text-muted",
	system: "bg-container-elevated-bg text-text-muted",
	local: "bg-feedback-error-subtle text-feedback-error",
	project: "bg-feedback-warning-subtle text-feedback-warning",
	user: "bg-feedback-info-subtle text-feedback-info",
	global: "bg-feedback-info-subtle text-feedback-info",
	default: "bg-container-elevated-bg text-text-subtle",
};

export function abbreviateHomePath(path: string): string {
	return path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~");
}

export function ScopeChip({ scope, testId }: { scope: string; testId?: string }) {
	return (
		<span
			data-testid={testId}
			data-scope={scope}
			className={cn(
				"shrink-0 rounded-[var(--radius-sm)] px-4 tr-text-label-pill uppercase",
				SCOPE_STYLES[scope] ?? SCOPE_STYLES.default,
			)}
		>
			{scope}
		</span>
	);
}

export function SourcePath({
	path,
	onOpen,
	testId,
}: {
	path: string;
	onOpen: (path: string) => void;
	testId?: string;
}) {
	return (
		<button
			type="button"
			data-testid={testId}
			title={path}
			onClick={() => onOpen(path)}
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
			className={cn(
				"shrink-0 rounded-[var(--radius-sm)] border border-border-default px-8 tr-text-label-pill uppercase hover:bg-control-bg-hovered",
				tone === "danger"
					? "text-text-subtle hover:text-feedback-error"
					: "text-text-muted hover:text-text-default",
			)}
		>
			{label}
		</button>
	);
}

export interface ScopedSettingSource {
	scope: string;
	path: string | null;
}

export function ScopedSettingRow({
	testIdPrefix,
	settingKey,
	docsUrl,
	docsTitle,
	source,
	value,
	shadowed,
	onOpen,
	actions,
}: {
	testIdPrefix: string;
	settingKey: string;
	docsUrl?: string | undefined;
	docsTitle?: string | undefined;
	source: ScopedSettingSource;
	value: ReactNode;
	shadowed: readonly (ScopedSettingSource & { value: unknown })[];
	onOpen: (path: string) => void;
	actions?: ReactNode;
}) {
	return (
		<div
			data-testid={`${testIdPrefix}-setting`}
			data-key={settingKey}
			className="border-border-muted border-b px-8 py-4"
		>
			<div className="flex flex-wrap items-start gap-x-4">
				<div className="flex min-w-0 max-w-full items-start gap-4">
					{docsUrl ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<a
									href={docsUrl}
									target="_blank"
									rel="noreferrer"
									data-testid={`${testIdPrefix}-setting-docs`}
									className="min-w-0 flex-1 break-words tr-code-text text-text-default hover:text-primary hover:underline"
								>
									{settingKey}
								</a>
							</TooltipTrigger>
							{docsTitle ? <TooltipContent>{docsTitle}</TooltipContent> : null}
						</Tooltip>
					) : (
						<span className="min-w-0 flex-1 break-words tr-code-text text-text-default">
							{settingKey}
						</span>
					)}
					<span className="shrink-0 tr-code-text text-text-muted">=</span>
				</div>
				<div className="flex min-w-0 max-w-full items-start">{value}</div>
			</div>
			<div className="flex items-center gap-4 py-2">
				{source.path ? (
					<SourcePath path={source.path} onOpen={onOpen} testId={`${testIdPrefix}-open-source`} />
				) : null}
				<ScopeChip scope={source.scope} testId={`${testIdPrefix}-scope-chip`} />
				<span className="flex-1" />
				{actions}
			</div>
			{shadowed.map((shadow) => (
				<div
					key={`${settingKey}:${shadow.scope}`}
					data-testid={`${testIdPrefix}-setting-shadowed`}
					className="mt-2 flex items-center gap-4 pl-8"
				>
					<span
						title={shadow.path ?? JSON.stringify(shadow.value)}
						className="line-clamp-2 min-w-0 flex-1 break-all tr-code-text text-text-subtle line-through"
					>
						{JSON.stringify(shadow.value)}
					</span>
					<ScopeChip scope={shadow.scope} testId={`${testIdPrefix}-scope-chip`} />
				</div>
			))}
		</div>
	);
}

export function SettingsToolbar({
	query,
	onQuery,
	onAdd,
	testIdPrefix,
}: {
	query: string;
	onQuery: (query: string) => void;
	onAdd?: (() => void) | undefined;
	testIdPrefix: string;
}) {
	return (
		<div className="flex items-center gap-8 border-border-default border-b px-8 py-8">
			<input
				value={query}
				onChange={(event) => onQuery(event.target.value)}
				placeholder="Filter keys…"
				aria-label="Filter settings keys"
				className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none placeholder:text-text-subtle focus:border-primary"
			/>
			{onAdd ? (
				<button
					type="button"
					data-testid={`${testIdPrefix}-setting-add`}
					onClick={onAdd}
					className="flex shrink-0 items-center gap-4 rounded-[var(--radius-sm)] border border-border-default px-12 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
				>
					<Plus className="size-14" /> Add a setting
				</button>
			) : null}
		</div>
	);
}
