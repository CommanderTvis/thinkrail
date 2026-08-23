import { RiMoreLine as More, RiAddLine as Plus } from "@remixicon/react";
import type { ClaudeMarketplaceAction } from "@thinkrail/contracts";
import {
	CLAUDE_PLUGIN_SCOPE_WORDING,
	CLAUDE_WRITABLE_SCOPES,
	type ClaudeCapability,
	type ClaudeEdit,
	type ClaudeWritableScope,
} from "@thinkrail/contracts";
import { useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type EditRequest, type OpenSource, ScopeChip, SourceButton } from "./ClaudeConfigParts";
import { ClaudeHookDialog } from "./ClaudeHookDialog";
import { ClaudeMcpServerDialog } from "./ClaudeMcpServerDialog";
import { ClaudePluginDialog } from "./ClaudePluginDialog";
import type { PluginMove } from "./ClaudePluginMoveDialog";
import type { PluginUninstall } from "./ClaudePluginUninstallDialog";
import { ClaudeSkillDialog } from "./ClaudeSkillDialog";

/** The edit a row's switch proposes, or null for a capability Claude Code gives no switch. */
function toggleFor(item: ClaudeCapability): { edit: ClaudeEdit; title: string } | null {
	if (item.kind === "mcp") {
		return {
			edit: { kind: "mcp", server: item.name, allowed: !item.enabled },
			title: item.enabled ? `Deny "${item.name}"` : `Allow "${item.name}"`,
		};
	}
	if (item.kind === "plugin") {
		return {
			edit: { kind: "plugin", name: item.name, enabled: !item.enabled },
			title: item.enabled ? `Turn off "${item.name}"` : `Turn on "${item.name}"`,
		};
	}
	if (item.kind === "skill") {
		return {
			edit: { kind: "skill", name: item.name, enabled: !item.enabled },
			title: item.enabled ? `Turn off "${item.name}"` : `Turn on "${item.name}"`,
		};
	}
	return null;
}

/** Uninstalling means running Claude's own CLI against a scope it accepts; managed settings have none. */
function uninstallableIn(item: ClaudeCapability): ClaudeWritableScope | null {
	if (item.kind !== "plugin") return null;
	const scope = CLAUDE_WRITABLE_SCOPES.find((candidate) => candidate === item.origin.scope);
	return scope ?? null;
}

/** The declaration's own scope, when Claude's CLI can address it. */
function marketplaceScopeOf(item: ClaudeCapability): ClaudeWritableScope | null {
	if (item.kind !== "marketplace") return null;
	return CLAUDE_WRITABLE_SCOPES.find((candidate) => candidate === item.origin.scope) ?? null;
}

const KIND_SECTIONS: readonly (readonly [ClaudeCapability["kind"], string])[] = [
	["mcp", "MCP servers"],
	["plugin", "Plugins"],
	["skill", "Skills"],
	["agent", "Subagents"],
	["hook", "Hooks"],
	["marketplace", "Marketplaces"],
];

const ADDABLE = [
	{ kind: "mcp", label: "MCP server" },
	{ kind: "skill", label: "Skill" },
	{ kind: "hook", label: "Hook" },
	{ kind: "plugin", label: "Plugin" },
	{ kind: "marketplace", label: "Marketplace" },
] as const;

export function ClaudeCapabilitiesSurface({
	capabilities,
	onOpen,
	onEdit,
	onUninstall,
	onMove,
	onMarketplace,
}: {
	capabilities: ClaudeCapability[];
	onOpen: OpenSource;
	onEdit: EditRequest;
	onUninstall: (target: PluginUninstall) => void;
	onMove: (target: PluginMove) => void;
	onMarketplace: (action: ClaudeMarketplaceAction) => void;
}) {
	const [adding, setAdding] = useState<"mcp" | "skill" | "hook" | "plugin" | null>(null);
	const compose = (pending: Parameters<EditRequest>[0]) => {
		setAdding(null);
		onEdit(pending);
	};

	return (
		<div className="flex flex-col">
			{/* Remounted per opening: each dialog seeds its fields once, and a cancelled draft should not
			    come back on the next click. */}
			<ClaudeMcpServerDialog
				key={`mcp:${adding === "mcp"}`}
				open={adding === "mcp"}
				onClose={() => setAdding(null)}
				onCompose={compose}
			/>
			<ClaudeSkillDialog
				key={`skill:${adding === "skill"}`}
				open={adding === "skill"}
				onClose={() => setAdding(null)}
				onCompose={compose}
			/>
			<ClaudeHookDialog
				key={`hook:${adding === "hook"}`}
				open={adding === "hook"}
				onClose={() => setAdding(null)}
				onCompose={compose}
			/>
			<ClaudePluginDialog
				key={`plugin:${adding === "plugin"}`}
				open={adding === "plugin"}
				onClose={() => setAdding(null)}
				onCompose={compose}
			/>

			<div className="flex flex-col gap-4 border-border-default border-b px-8 py-4">
				<span className="tr-text-eyebrow text-text-muted">What Claude can reach</span>
				<div className="flex flex-wrap gap-4">
					{ADDABLE.map((option) => (
						<button
							key={option.kind}
							type="button"
							data-testid={`claude-add-${option.kind}`}
							onClick={() =>
								option.kind === "marketplace"
									? onMarketplace({ kind: "add", source: "", scope: "user" })
									: setAdding(option.kind)
							}
							className="flex shrink-0 items-center gap-4 rounded-[var(--radius-sm)] border border-border-default px-8 py-2 tr-text-label-pill text-text-muted uppercase hover:bg-control-bg-hovered hover:text-text-default"
						>
							<Plus className="size-12" /> {option.label}
						</button>
					))}
				</div>
			</div>

			{capabilities.length === 0 ? (
				<p className="p-8 tr-text-ui text-text-muted">
					Nothing grants Claude extra abilities here.
				</p>
			) : null}

			{KIND_SECTIONS.map(([kind, heading]) => {
				const rows = capabilities.filter((item) => item.kind === kind);
				if (rows.length === 0) return null;
				return (
					<section key={kind} data-testid="claude-capability-section" data-kind={kind}>
						<div className="bg-container-header-bg px-8 py-2 tr-text-eyebrow text-text-muted">
							{heading}
						</div>
						{rows.map((item) => {
							const toggle = toggleFor(item);
							const uninstallScope = uninstallableIn(item);
							const marketplaceScope = marketplaceScopeOf(item);
							return (
								<div
									key={`${item.kind}:${item.name}:${item.origin.path ?? ""}`}
									data-testid="claude-capability"
									data-kind={item.kind}
									data-name={item.name}
									data-enabled={item.enabled}
									className="flex flex-col border-border-muted border-b px-8 py-4"
								>
									<div className="flex min-w-0 items-center gap-4">
										<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default">
											{item.name}
										</span>
										<ScopeChip scope={item.origin.scope} />
										{item.enabled ? null : (
											<span
												title={
													item.disabledBy?.path
														? `Switched off in ${item.disabledBy.scope} settings`
														: undefined
												}
												className="shrink-0 tr-text-label-pill text-text-subtle uppercase"
											>
												off{item.disabledBy ? ` · ${item.disabledBy.scope}` : ""}
											</span>
										)}
										{toggle || uninstallScope || marketplaceScope ? (
											<DropdownMenu>
												<DropdownMenuTrigger
													data-testid="claude-capability-menu"
													aria-label={`Actions for ${item.name}`}
													className="shrink-0 rounded-[var(--radius-sm)] p-2 text-text-subtle outline-none hover:bg-control-bg-hovered hover:text-text-default"
												>
													<More className="size-14" />
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													{toggle ? (
														<DropdownMenuItem
															data-testid="claude-capability-toggle"
															onSelect={() => onEdit(toggle)}
														>
															{item.enabled ? "Turn off" : "Turn on"}
														</DropdownMenuItem>
													) : null}
													{marketplaceScope ? (
														<>
															<DropdownMenuItem
																data-testid="claude-marketplace-update"
																onSelect={() => onMarketplace({ kind: "update", name: item.name })}
															>
																Update from source…
															</DropdownMenuItem>
															<DropdownMenuItem
																data-testid="claude-marketplace-remove"
																onSelect={() =>
																	onMarketplace({
																		kind: "remove",
																		name: item.name,
																		scope: marketplaceScope,
																	})
																}
															>
																Remove…
															</DropdownMenuItem>
														</>
													) : null}
													{uninstallScope
														? CLAUDE_WRITABLE_SCOPES.filter(
																(scope) => scope !== uninstallScope,
															).map((scope) => (
																<DropdownMenuItem
																	key={scope}
																	data-testid={`claude-capability-move-${scope}`}
																	onSelect={() =>
																		onMove({ name: item.name, from: uninstallScope, to: scope })
																	}
																>
																	<span className="flex flex-col">
																		<span>Move to {scope}…</span>
																		<span className="tr-text-metadata text-text-subtle">
																			{CLAUDE_PLUGIN_SCOPE_WORDING[scope]}
																		</span>
																	</span>
																</DropdownMenuItem>
															))
														: null}
													{uninstallScope ? (
														<DropdownMenuItem
															data-testid="claude-capability-uninstall"
															onSelect={() =>
																onUninstall({ name: item.name, scope: uninstallScope })
															}
														>
															Uninstall…
														</DropdownMenuItem>
													) : null}
												</DropdownMenuContent>
											</DropdownMenu>
										) : null}
									</div>
									{item.disabledBy?.path && item.disabledBy.path !== item.origin.path ? (
										<SourceButton
											path={item.disabledBy.path}
											keyPath={item.disabledBy.keyPath}
											onOpen={onOpen}
										/>
									) : null}
									{item.origin.path ? (
										<SourceButton
											path={item.origin.path}
											keyPath={item.origin.keyPath}
											onOpen={onOpen}
										/>
									) : null}
									{item.detail ? (
										<span className="truncate tr-code-text text-text-subtle">{item.detail}</span>
									) : null}
								</div>
							);
						})}
					</section>
				);
			})}
		</div>
	);
}
