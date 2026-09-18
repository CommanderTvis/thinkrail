import {
	RiAlertLine as AlertTriangle,
	RiFileTextLine as FileText,
	RiRefreshLine as RefreshCw,
} from "@remixicon/react";
import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import {
	abbreviateHomePath,
	IconTooltip,
	RowAction,
	ScopeChip,
	SourcePath,
	ToggleSegment,
} from "@thinkrail/plugin-ui";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type {
	CodexConfigSnapshot,
	CodexInstructionsTarget,
	CodexValue,
	CodexWritableScope,
	codexContract,
} from "../contracts";
import { createCodexAccountSurface } from "./CodexAccountSurface";
import { CodexSettingsSurface } from "./CodexSettingsSurface";

type Ctx = PluginWebContext<typeof codexContract>;

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

const hasProject = (snapshot: CodexConfigSnapshot, name: string) =>
	snapshot.instructions.some((file) => file.relativePath === name);

const OFFERS: {
	target: CodexInstructionsTarget;
	title: string;
	detail: string;
	missing: (snapshot: CodexConfigSnapshot) => boolean;
}[] = [
	{
		target: "project",
		title: "Add AGENTS.md",
		detail:
			"Shared instructions for everyone on this project. Commit it and it stays with the repo.",
		missing: (snapshot) => !snapshot.instructions.some((file) => file.scope === "project"),
	},
	{
		target: "project-override",
		title: "Add AGENTS.override.md",
		detail:
			"Replaces AGENTS.md here without touching it, can be added to .gitignore for machine-local instructions.",
		missing: (snapshot) => !hasProject(snapshot, "AGENTS.override.md"),
	},
	{
		target: "global",
		title: "Add ~/.codex/AGENTS.md",
		detail: "Your own instructions for every project Codex runs in.",
		missing: (snapshot) => !snapshot.instructions.some((file) => file.scope === "global"),
	},
];

function formatSize(bytes: number): string {
	return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024).toLocaleString()} KB`;
}

type Surface = "context" | "settings" | "capabilities" | "account";

const SURFACES: { value: Surface; label: string }[] = [
	{ value: "context", label: "Context" },
	{ value: "settings", label: "Settings" },
	{ value: "capabilities", label: "Capabilities" },
	{ value: "account", label: "Account" },
];

export function createCodexPanel(ctx: Ctx) {
	const AccountSurface = createCodexAccountSurface(ctx);
	return function CodexPanel({ workspaceId }: { workspaceId: string }) {
		const [accountReloads, setAccountReloads] = useState(0);
		const [snapshot, setSnapshot] = useState<CodexConfigSnapshot | null>(null);
		const [error, setError] = useState<string | null>(null);

		const run = useCallback((call: Promise<CodexConfigSnapshot>) => {
			call.then(
				(next) => {
					setSnapshot(next);
					setError(null);
				},
				(err: unknown) => setError(errorText(err)),
			);
		}, []);
		const refresh = useCallback(
			() => run(ctx.request("configGet", { workspaceId })),
			[run, workspaceId],
		);
		useEffect(refresh, [refresh]);

		const setValue = (scope: CodexWritableScope, keyPath: string[], value: CodexValue | null) =>
			run(ctx.request("setValue", { workspaceId, scope, keyPath, value }));

		const offer = (target: CodexInstructionsTarget) => {
			ctx.request("createInstructions", { workspaceId, target }).then(
				(created) => {
					if (created.relativePath) void ctx.editors.open(workspaceId, created.relativePath);
					else ctx.notify("info", `Created ${created.path}`);
					refresh();
				},
				(err: unknown) => setError(errorText(err)),
			);
		};

		const open = (path: string) => {
			ctx.editors
				.open(workspaceId, path)
				.catch(() => ctx.notify("error", `Couldn't open ${abbreviateHomePath(path)}`));
		};

		const [surface, setSurface] = useState<Surface>("context");

		const notices: { key: string; detail: ReactNode; path?: string }[] = [];
		for (const layer of snapshot?.layers ?? []) {
			if (layer.error) notices.push({ key: layer.path, detail: layer.error, path: layer.path });
			else if (layer.ignored) {
				notices.push({
					key: layer.path,
					detail: "Skipped: Codex does not trust this project yet, so it ignores this file.",
					path: layer.path,
				});
			}
		}
		if (snapshot?.hooksInstalled && !snapshot.hooksTrusted) {
			notices.push({
				key: "hooks",
				detail: (
					<>
						Codex skips the status hooks until you trust them: run{" "}
						<span className="tr-code-text">/hooks</span> inside Codex once, then refresh.
					</>
				),
			});
		}

		return (
			<div
				data-testid="codex-config"
				className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-container-sidebar-bg"
			>
				<div className="flex min-h-panel-header-row shrink-0 items-center gap-8 px-8 py-4">
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-8 gap-y-4">
						{SURFACES.map((option) => (
							<ToggleSegment
								key={option.value}
								testid={`codex-surface-${option.value}`}
								label={option.label}
								active={surface === option.value}
								onClick={() => setSurface(option.value)}
							/>
						))}
					</div>
					<IconTooltip
						label={surface === "account" ? "Refresh account and usage" : "Re-read configuration"}
					>
						<button
							type="button"
							data-testid="codex-config-refresh"
							aria-label={
								surface === "account" ? "Refresh account and usage" : "Re-read configuration"
							}
							onClick={() =>
								surface === "account" ? setAccountReloads((value) => value + 1) : refresh()
							}
							className="flex size-20 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						>
							<RefreshCw className="size-14" />
						</button>
					</IconTooltip>
				</div>

				{error ? (
					<p data-testid="codex-config-error" className="px-8 py-4 tr-text-ui text-feedback-error">
						{error}
					</p>
				) : null}

				{notices.map((notice) => (
					<div
						key={notice.key}
						data-testid="codex-config-problem"
						className="flex items-start gap-4 border-border-muted border-b px-8 py-4"
					>
						<AlertTriangle className="mt-2 size-14 shrink-0 text-feedback-warning" />
						<div className="flex min-w-0 flex-col">
							<span className="tr-text-metadata text-text-muted">{notice.detail}</span>
							{notice.path ? <SourcePath path={notice.path} onOpen={open} /> : null}
						</div>
					</div>
				))}

				<div className="min-h-0 flex-1 overflow-y-auto">
					{surface === "account" ? (
						<AccountSurface key={accountReloads} />
					) : !snapshot ? (
						<p className="p-8 tr-text-ui text-text-muted">Reading Codex configuration…</p>
					) : surface === "context" ? (
						<div className="flex flex-col">
							{OFFERS.filter((item) => item.missing(snapshot)).map((item) => (
								<button
									key={item.target}
									type="button"
									data-testid={`codex-offer-${item.target}`}
									onClick={() => offer(item.target)}
									className="flex flex-col items-start gap-2 border-border-muted border-b px-8 py-4 text-left hover:bg-control-bg-hovered"
								>
									<span className="tr-text-ui text-text-default">{item.title}</span>
									<span className="tr-text-metadata text-text-muted">{item.detail}</span>
								</button>
							))}
							<div
								data-testid="codex-context-total"
								className="flex items-baseline justify-between gap-8 border-border-default border-b px-8 py-4"
							>
								<span className="tr-text-eyebrow text-text-muted">Persistent context</span>
								<span className="tr-code-text text-text-default">
									{formatSize(snapshot.instructions.reduce((sum, file) => sum + file.bytes, 0))}
								</span>
							</div>
							{snapshot.instructions.map((file) => (
								<div
									key={file.path}
									data-testid="codex-instructions"
									className="flex min-w-0 items-center gap-8 px-8 py-4"
								>
									<FileText className="size-14 shrink-0 text-text-subtle" />
									<div className="flex min-w-0 flex-1 flex-col">
										<div className="flex items-center gap-4">
											<span className="truncate tr-text-ui text-text-default">
												{file.path.split(/[\\/]/).pop()}
											</span>
											<ScopeChip scope={file.scope === "global" ? "user" : file.scope} />
										</div>
										<SourcePath
											path={file.path}
											onOpen={() => open(file.relativePath ?? file.path)}
										/>
									</div>
									<span className="shrink-0 tr-code-text text-text-muted tabular-nums">
										{formatSize(file.bytes)}
									</span>
								</div>
							))}
						</div>
					) : surface === "settings" ? (
						<>
							<p
								data-testid="codex-project-trust"
								className="border-border-muted border-b px-8 py-4 tr-text-metadata text-text-muted"
							>
								{snapshot.projectTrusted
									? "Codex trusts this project, so its .codex/config.toml applies."
									: "Codex does not trust this project yet — its .codex/config.toml is ignored until you trust it when Codex asks."}
							</p>
							<CodexSettingsSurface settings={snapshot.settings} onSave={setValue} onOpen={open} />
						</>
					) : (
						<div className="flex flex-col">
							<div
								data-testid="codex-capability"
								data-kind="hooks"
								className="flex items-start gap-8 border-border-muted border-b px-8 py-4"
							>
								<div className="flex min-w-0 flex-1 flex-col">
									<span className="tr-code-text text-text-default">ThinkRail status hooks</span>
									<span className="tr-text-metadata text-text-muted">
										{snapshot.hooksInstalled
											? snapshot.hooksTrusted
												? "Installed and trusted."
												: "Installed; waiting for you to trust them in Codex."
											: "Report running, waiting and done to ThinkRail. Inert outside a ThinkRail terminal."}
									</span>
								</div>
								{snapshot.hooksInstalled ? (
									<ScopeChip scope="user" />
								) : (
									<RowAction
										testid="codex-install-hooks"
										label="Install"
										onClick={() => run(ctx.request("installHooks", { workspaceId }))}
									/>
								)}
							</div>
							{snapshot.mcpServers.map((server) => (
								<div
									key={server.name}
									data-testid="codex-capability"
									data-kind="mcp"
									className="border-border-muted border-b px-8 py-4"
								>
									<div className="flex items-start gap-4">
										<span className="min-w-0 flex-1 tr-code-text text-text-default">
											{server.name}
										</span>
										<ScopeChip scope={server.scope} />
									</div>
									<div className="truncate tr-code-text text-text-muted">{server.target}</div>
									<SourcePath path={server.path} onOpen={open} />
								</div>
							))}
							<div className="border-border-muted border-b px-8 py-4">
								<span className="tr-code-text text-text-default">thinkrail</span>
								<p className="tr-text-metadata text-text-muted">
									ThinkRail's own MCP server, added to every session the launcher starts unless
									turned off in Settings.
								</p>
							</div>
						</div>
					)}
				</div>
			</div>
		);
	};
}
