import {
	RiAlertLine as AlertTriangle,
	RiFileTextLine as FileText,
	RiInformationLine as Info,
	RiRefreshLine as RefreshCw,
} from "@remixicon/react";
import type {
	ClaudeConfigSnapshot,
	ClaudeContextLayer,
	ClaudeEdit,
	ClaudeMarketplaceAction,
} from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { QuietScrollArea } from "@/components/QuietScrollArea";
import { IconTooltip } from "@/components/ui/tooltip";
import { useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { ClaudeCapabilitiesSurface } from "./ClaudeCapabilitiesSurface";
import {
	type EditRequest,
	type OpenSource,
	ScopeChip,
	SourceButton,
	useOpenSource,
} from "./ClaudeConfigParts";
import { ClaudeEditDialog } from "./ClaudeEditDialog";
import { ClaudeMarketplaceDialog } from "./ClaudeMarketplaceDialog";
import { ClaudePluginMoveDialog, type PluginMove } from "./ClaudePluginMoveDialog";
import { ClaudePluginUninstallDialog, type PluginUninstall } from "./ClaudePluginUninstallDialog";
import { ClaudeSettingsSurface } from "./ClaudeSettingsSurface";
import { ToggleSegment } from "./ToggleSegment";

type Surface = "context" | "settings" | "capabilities";

const SURFACES: { value: Surface; label: string }[] = [
	{ value: "context", label: "Context" },
	{ value: "settings", label: "Settings" },
	{ value: "capabilities", label: "Capabilities" },
];

// An `@`-import nests under the file that pulled it in. Padding alone read as a near-invisible step, so each
// level draws its own rule: consecutive rows at one depth join into a continuous line down the tree.
const MAX_INDENT_GUIDES = 4;

function indentGuides(layer: ClaudeContextLayer): string[] {
	const depth = Math.min(layer.depth ?? 0, MAX_INDENT_GUIDES);
	return Array.from({ length: depth }, (_, level) => `${layer.path}:guide:${level}`);
}

function formatSize(bytes: number): string {
	return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024).toLocaleString()} KB`;
}

function ContextSurface({
	layers,
	onOpen,
	onEdit,
}: {
	layers: ClaudeContextLayer[];
	onOpen: OpenSource;
	onEdit: EditRequest;
}) {
	const alwaysOn = layers.filter((layer) => !layer.lazy);
	// Size, not an estimated token count: bytes are what we actually know, and a made-up token number
	// invited a precision the pane never had — see claudeConfig/SPEC.md.
	const total = alwaysOn.reduce((sum, layer) => sum + layer.bytes, 0);
	if (layers.length === 0) {
		return (
			<p className="p-8 tr-text-ui text-text-muted">No instruction files reach this workspace.</p>
		);
	}
	const hasRootLevelProjectClaudeMd = layers.some(
		(layer) =>
			layer.kind === "instructions" &&
			layer.origin.scope === "project" &&
			!/[\\/]\.claude[\\/]/.test(layer.path),
	);
	return (
		<div className="flex flex-col">
			{hasRootLevelProjectClaudeMd ? null : (
				<button
					type="button"
					data-testid="claude-offer-project-md"
					onClick={() =>
						onEdit({
							edit: { kind: "file", template: "project-instructions" },
							title: "Create CLAUDE.md",
						})
					}
					className="flex flex-col items-start gap-2 border-border-muted border-b px-8 py-4 text-left hover:bg-control-bg-hovered"
				>
					<span className="tr-text-ui text-text-default">Add CLAUDE.md</span>
					<span className="tr-text-metadata text-text-muted">
						Shared instructions for everyone on this project. Commit it and it stays with the repo.
					</span>
				</button>
			)}
			{layers.some((layer) => layer.path.endsWith("CLAUDE.local.md")) ? null : (
				<button
					type="button"
					data-testid="claude-offer-local-md"
					onClick={() =>
						onEdit({
							edit: { kind: "file", template: "project-local-instructions" },
							title: "Create CLAUDE.local.md",
						})
					}
					className="flex flex-col items-start gap-2 border-border-muted border-b px-8 py-4 text-left hover:bg-control-bg-hovered"
				>
					<span className="tr-text-ui text-text-default">Add CLAUDE.local.md</span>
					<span className="tr-text-metadata text-text-muted">
						Project instructions that stay on this machine, like which toolchain is installed here.
					</span>
				</button>
			)}
			<div
				data-testid="claude-context-total"
				className="flex items-baseline justify-between gap-8 border-border-default border-b px-8 py-4"
			>
				<span className="tr-text-eyebrow text-text-muted">Persistent context</span>
				<span className="tr-code-text text-text-default">{formatSize(total)}</span>
			</div>
			{layers.map((layer) => (
				<div
					key={layer.path}
					data-testid="claude-context-layer"
					data-kind={layer.kind}
					data-depth={layer.depth ?? 0}
					className="flex items-stretch border-border-muted border-b"
				>
					{indentGuides(layer).map((guide) => (
						<span
							key={guide}
							aria-hidden="true"
							className="ml-8 w-12 shrink-0 border-border-default border-l"
						/>
					))}
					<div className="flex min-w-0 flex-1 items-center gap-8 py-4 pr-8 pl-8">
						<FileText className="size-14 shrink-0 text-text-subtle" />
						<div className="flex min-w-0 flex-1 flex-col">
							<div className="flex items-center gap-4">
								<span className="truncate tr-text-ui text-text-default">{layer.label}</span>
								<ScopeChip scope={layer.origin.scope} />
								{layer.lazy ? (
									<span
										title={`Loads only when Claude reads: ${(layer.pathGlobs ?? []).join(", ")}`}
										className="shrink-0 tr-text-label-pill text-text-subtle uppercase"
									>
										on demand
									</span>
								) : null}
							</div>
							<SourceButton path={layer.path} onOpen={onOpen} />
						</div>
						<span className="shrink-0 tr-code-text text-text-muted tabular-nums">
							{formatSize(layer.bytes)}
						</span>
					</div>
				</div>
			))}
		</div>
	);
}

export function ClaudeConfigPanel({ workspaceId }: { workspaceId: string }) {
	const [pendingEdit, setPendingEdit] = useState<{ edit: ClaudeEdit; title: string } | null>(null);
	const [uninstalling, setUninstalling] = useState<PluginUninstall | null>(null);
	const [moving, setMoving] = useState<PluginMove | null>(null);
	const [marketAction, setMarketAction] = useState<ClaudeMarketplaceAction | null>(null);
	const [snapshot, setSnapshot] = useState<ClaudeConfigSnapshot | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [surface, setSurface] = useState<Surface>("context");
	const tick = useAppStore((state) => state.fsChangesByWorkspace[workspaceId]?.tick ?? 0);
	const openSource = useOpenSource(workspaceId);

	// Ordering guard only — never a guard on *issuing* the read.
	const applied = useRef(-1);
	const load = useCallback(
		(generation: number) => {
			let current = true;
			void getTransport()
				.request("claudeConfig.get", { workspaceId })
				.then((result) => {
					if (!current || generation < applied.current) return;
					applied.current = generation;
					setSnapshot(result);
					setError(null);
				})
				.catch((cause: unknown) => {
					if (current) setError(errorText(cause));
				});
			return () => {
				current = false;
			};
		},
		[workspaceId],
	);

	// A resolved answer is only true for the files as they are on disk right now, so a worktree change re-reads rather than leaving a confidently stale view on screen.
	useEffect(() => load(tick), [tick, load]);

	return (
		<div
			data-testid="claude-config-panel"
			className="flex h-full min-h-0 flex-col bg-container-sidebar-bg"
		>
			<div className="flex h-panel-header-row shrink-0 items-center gap-8 px-8">
				{SURFACES.map((option) => (
					<ToggleSegment
						key={option.value}
						testid={`claude-surface-${option.value}`}
						label={option.label}
						active={surface === option.value}
						onClick={() => setSurface(option.value)}
					/>
				))}
				<IconTooltip label="Re-read configuration">
					<button
						type="button"
						data-testid="claude-config-refresh"
						aria-label="Re-read configuration"
						onClick={() => load(applied.current)}
						className="ml-auto flex size-20 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<RefreshCw className="size-14" />
					</button>
				</IconTooltip>
			</div>

			{error ? (
				<p data-testid="claude-config-error" className="px-8 py-4 tr-text-ui text-feedback-error">
					{error}
				</p>
			) : null}

			{snapshot?.problems.map((problem) => (
				<div
					key={problem.title + (problem.path ?? "")}
					data-testid="claude-config-problem"
					data-severity={problem.severity}
					className="flex items-start gap-4 border-border-muted border-b px-8 py-4"
				>
					{problem.severity === "warning" ? (
						<AlertTriangle className="mt-2 size-14 shrink-0 text-feedback-warning" />
					) : (
						<Info className="mt-2 size-14 shrink-0 text-feedback-info" />
					)}
					<div className="flex min-w-0 flex-col">
						<span className="tr-text-ui text-text-default">{problem.title}</span>
						<span className="tr-text-metadata text-text-muted">{problem.detail}</span>
						{problem.path ? <SourceButton path={problem.path} onOpen={openSource} /> : null}
					</div>
				</div>
			))}

			<ClaudePluginUninstallDialog
				workspaceId={workspaceId}
				target={uninstalling}
				onClose={() => setUninstalling(null)}
				onDone={() => load(applied.current)}
			/>

			<ClaudePluginMoveDialog
				workspaceId={workspaceId}
				target={moving}
				onClose={() => setMoving(null)}
				onDone={() => load(applied.current)}
			/>

			<ClaudeMarketplaceDialog
				key={marketAction ? JSON.stringify(marketAction) : "idle"}
				workspaceId={workspaceId}
				target={marketAction}
				onClose={() => setMarketAction(null)}
				onDone={() => load(applied.current)}
			/>

			<ClaudeEditDialog
				// Remounted per edit: the dialog holds the chosen scope and the approved plan, and carrying
				// those into the next edit let one edit be applied against another's plan — see its comment.
				key={pendingEdit ? JSON.stringify(pendingEdit.edit) : "idle"}
				workspaceId={workspaceId}
				edit={pendingEdit?.edit ?? null}
				title={pendingEdit?.title ?? ""}
				onClose={() => setPendingEdit(null)}
				onApplied={() => load(applied.current)}
			/>

			<QuietScrollArea className="min-h-0 flex-1">
				{!snapshot ? (
					<p className="p-8 tr-text-ui text-text-muted">Reading configuration…</p>
				) : surface === "context" ? (
					<ContextSurface layers={snapshot.context} onOpen={openSource} onEdit={setPendingEdit} />
				) : surface === "settings" ? (
					<ClaudeSettingsSurface
						settings={snapshot.settings}
						knownKeys={snapshot.knownSettingKeys}
						onOpen={openSource}
						onEdit={setPendingEdit}
					/>
				) : (
					<ClaudeCapabilitiesSurface
						capabilities={snapshot.capabilities}
						onUninstall={setUninstalling}
						onMove={setMoving}
						onMarketplace={setMarketAction}
						onOpen={openSource}
						onEdit={setPendingEdit}
					/>
				)}
			</QuietScrollArea>
		</div>
	);
}
