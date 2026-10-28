import {
	RiAddLine as Plus,
	RiRefreshLine as Refresh,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { PluginRosterEntry } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useState } from "react";
import { pluginAssetBase, pluginIcon, usePluginRegistry } from "@/plugins/registry";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { SettingsSwitch } from "./SettingsSwitch";

function transitiveDependsOn(id: string, byId: Map<string, PluginRosterEntry>): Set<string> {
	const seen = new Set<string>();
	const stack = [id];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined) continue;
		for (const dep of byId.get(current)?.dependsOn ?? []) {
			if (!seen.has(dep)) {
				seen.add(dep);
				stack.push(dep);
			}
		}
	}
	return seen;
}

/** Disabled dependencies an enable of `id` must turn on alongside it, transitively. */
export function pluginsToEnable(id: string, roster: readonly PluginRosterEntry[]): string[] {
	const byId = new Map(roster.map((entry) => [entry.id, entry]));
	return [...transitiveDependsOn(id, byId)].filter((dep) => byId.get(dep)?.status === "disabled");
}

/** Currently-enabled plugins reachable from `id` through `dependsOn` — a disable cascades to them. */
export function activeDependents(id: string, roster: readonly PluginRosterEntry[]): string[] {
	const byId = new Map(roster.map((entry) => [entry.id, entry]));
	const dependents = new Set<string>();
	let frontier = [id];
	while (frontier.length > 0) {
		const next: string[] = [];
		for (const target of frontier) {
			for (const entry of roster) {
				if (entry.id !== id && !dependents.has(entry.id) && entry.dependsOn.includes(target)) {
					dependents.add(entry.id);
					next.push(entry.id);
				}
			}
		}
		frontier = next;
	}
	return [...dependents].filter((dep) => byId.get(dep)?.status !== "disabled");
}

function contributionSummary(entry: PluginRosterEntry): string | null {
	const parts: string[] = [];
	if (entry.contributes.sideTools.length > 0) {
		parts.push(
			`${entry.contributes.sideTools.length} side tool${entry.contributes.sideTools.length === 1 ? "" : "s"}`,
		);
	}
	if (entry.contributes.fileViewers.length > 0) {
		parts.push(
			`${entry.contributes.fileViewers.length} file viewer${entry.contributes.fileViewers.length === 1 ? "" : "s"}`,
		);
	}
	return parts.length > 0 ? parts.join(", ") : null;
}

async function setEnabled(ids: readonly string[], enabled: boolean, label: string): Promise<void> {
	const plugins = Object.fromEntries(ids.map((id) => [id, { enabled }]));
	try {
		await getTransport().request("settings.update", { config: { plugins } });
	} catch (err) {
		toast.error(errorText(err), `Couldn't ${enabled ? "enable" : "disable"} ${label}`);
	}
}

function PluginRow({ entry }: { entry: PluginRosterEntry }) {
	const t = useT();
	const roster = usePluginRegistry((s) => s.roster);
	const httpBase = usePluginRegistry((s) => s.httpBase);
	const [confirmDeps, setConfirmDeps] = useState<string[] | null>(null);
	const Icon = pluginIcon(entry.icon, false, pluginAssetBase(entry, httpBase));
	const unavailable = entry.runsInBrowserTab === false;
	const enabled = entry.status !== "disabled" && !unavailable;
	const dependents = enabled ? activeDependents(entry.id, roster) : [];
	const labelOf = (id: string) => roster.find((candidate) => candidate.id === id)?.label ?? id;
	const summary = contributionSummary(entry);

	const toggle = () => {
		if (enabled) {
			void setEnabled([entry.id], false, entry.label);
			return;
		}
		const deps = pluginsToEnable(entry.id, roster);
		if (deps.length === 0) {
			void setEnabled([entry.id], true, entry.label);
			return;
		}
		setConfirmDeps(deps);
	};

	return (
		<div
			data-testid="settings-plugins-row"
			data-plugin-id={entry.id}
			data-status={entry.status}
			className="flex items-start gap-12 rounded-sm border border-border-default bg-control-bg px-12 py-8"
		>
			<Icon className="mt-2 size-16 shrink-0 text-text-muted" />
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<div className="flex items-center gap-8">
					<span className="tr-title-compact text-text-default">{entry.label}</span>
					{entry.origin === "external" ? (
						<span className="tr-text-metadata text-text-subtle">v{entry.version}</span>
					) : null}
					<span className="rounded-full border border-border-default px-4 py-2 tr-text-label-pill text-text-subtle">
						{entry.origin}
					</span>
				</div>
				{entry.description ? (
					<span className="text-text-default tr-text-metadata">{entry.description}</span>
				) : null}
				{summary ? <span className="text-text-muted tr-text-metadata">{summary}</span> : null}
				{entry.modifiesSystemPrompt ? (
					<span className="text-text-muted tr-text-metadata">
						{t("settings.plugins.modifiesSystemPrompt")}
					</span>
				) : null}
				{entry.status === "failed" || entry.status === "refused" ? (
					<span className="text-feedback-error tr-text-metadata">
						{entry.reason ?? `${entry.status}`}
					</span>
				) : null}
				{dependents.length > 0 ? (
					<span className="text-text-muted tr-text-metadata">
						{t("settings.plugins.alsoUsedBy", { plugins: dependents.map(labelOf).join(", ") })}
					</span>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-8">
				{entry.status === "failed" ? (
					<Button
						variant="outline"
						size="m"
						data-testid="settings-plugin-retry"
						onClick={() => {
							getTransport()
								.request("plugins.retry", { id: entry.id })
								.catch((err: unknown) =>
									toast.error(errorText(err), `Couldn't retry ${entry.label}`),
								);
						}}
					>
						{t("common.retry")}
					</Button>
				) : null}
				<SettingsSwitch
					checked={enabled}
					disabled={unavailable}
					label={t("settings.plugins.enabled", { plugin: entry.label })}
					testId="settings-plugin-toggle"
					onChange={toggle}
				/>
			</div>

			<Dialog
				open={confirmDeps !== null}
				onOpenChange={(o) => {
					if (!o) setConfirmDeps(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{t("settings.plugins.alsoTurnOn", {
								plugins: confirmDeps?.map(labelOf).join(", ") ?? "",
							})}
						</DialogTitle>
					</DialogHeader>
					<DialogDescription>
						{t("settings.plugins.dependsOn", {
							plugin: entry.label,
							plugins: confirmDeps?.map(labelOf).join(", ") ?? "",
						})}
					</DialogDescription>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmDeps(null)}>
							{t("common.cancel")}
						</Button>
						<Button
							onClick={() => {
								const deps = confirmDeps ?? [];
								setConfirmDeps(null);
								void setEnabled([entry.id, ...deps], true, entry.label);
							}}
						>
							{t("settings.plugins.enable")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function PluginPathsEditor() {
	const t = useT();
	const pluginPaths = useAppStore((s) => s.pluginPaths);
	const [draft, setDraft] = useState("");

	const save = (next: string[]) => {
		getTransport()
			.request("settings.update", { config: { pluginPaths: next } })
			.catch((err: unknown) => toast.error(errorText(err), "Couldn't update the plugin paths"));
	};

	const add = () => {
		const path = draft.trim();
		if (!path || pluginPaths.includes(path)) return;
		save([...pluginPaths, path]);
		setDraft("");
	};

	return (
		<div className="flex flex-col gap-8">
			<h4 className="tr-text-eyebrow text-text-muted">
				{t("settings.plugins.externalDirectories")}
			</h4>
			<div className="flex flex-col gap-4">
				{pluginPaths.map((path) => (
					<div
						key={path}
						className="flex items-center gap-8 rounded-sm border border-border-default bg-control-bg px-12 py-4"
					>
						<span className="min-w-0 flex-1 truncate tr-code-text text-text-default">{path}</span>
						<IconButton
							variant="ghost"
							size="m"
							tone="danger"
							icon={Trash2}
							label={t("settings.plugins.removePath", { path })}
							onClick={() => save(pluginPaths.filter((candidate) => candidate !== path))}
						/>
					</div>
				))}
			</div>
			<div className="flex items-center gap-4">
				<input
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") add();
					}}
					placeholder={t("settings.plugins.pathPlaceholder")}
					spellCheck={false}
					className="min-w-0 flex-1 rounded-sm border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none placeholder:text-text-subtle focus:border-primary"
				/>
				<Button size="m" variant="outline" data-testid="settings-plugin-path-add" onClick={add}>
					<Plus className="size-14" />
					{t("common.add")}
				</Button>
			</div>
		</div>
	);
}

export function PluginsSettings() {
	const t = useT();
	const roster = usePluginRegistry((s) => s.roster);

	return (
		<section data-testid="settings-plugins" className="flex flex-col gap-16">
			<div className="flex items-center justify-between gap-8">
				<div className="flex flex-col gap-4">
					<h3 className="tr-title-section text-text-default">{t("settings.nav.plugins")}</h3>
					<p className="text-text-muted tr-text-metadata">{t("settings.plugins.description")}</p>
				</div>
				<Button
					variant="outline"
					size="m"
					data-testid="settings-plugins-rescan"
					onClick={() => {
						getTransport()
							.request("plugins.rescan", {})
							.catch((err: unknown) =>
								toast.error(errorText(err), "Couldn't rescan plugin directories"),
							);
					}}
				>
					<Refresh className="size-14" />
					{t("settings.plugins.rescan")}
				</Button>
			</div>

			<div className="flex flex-col gap-8">
				{roster
					.filter((entry) => entry.runsInBrowserTab !== false)
					.map((entry) => (
						<PluginRow key={entry.id} entry={entry} />
					))}
			</div>

			{roster.some((entry) => entry.runsInBrowserTab === false) ? (
				<div data-testid="settings-plugins-unavailable" className="flex flex-col gap-8">
					<span className="tr-text-eyebrow text-text-muted">
						{t("settings.plugins.unavailableInTab")}
					</span>
					{roster
						.filter((entry) => entry.runsInBrowserTab === false)
						.map((entry) => (
							<PluginRow key={entry.id} entry={entry} />
						))}
				</div>
			) : null}

			<PluginPathsEditor />
		</section>
	);
}
