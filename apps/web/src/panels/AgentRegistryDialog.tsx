import {
	RiCheckLine as Check,
	RiDownloadLine as Download,
	RiLoader4Line as Loader2,
	RiRefreshLine as RefreshCw,
	RiAlertLine as TriangleAlert,
} from "@remixicon/react";
import type { AgentRegistryEntry } from "@thinkrail/contracts";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { errorText, getTransport } from "@/transport";

export function AgentRegistryDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [entries, setEntries] = useState<AgentRegistryEntry[] | null>(null);
	const [stale, setStale] = useState(false);
	const [failed, setFailed] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [query, setQuery] = useState("");
	const [installingId, setInstallingId] = useState<string | null>(null);
	const [installError, setInstallError] = useState<{ id: string; message: string } | null>(null);

	const load = useCallback(async (refresh: boolean) => {
		setLoading(true);
		try {
			const list = await getTransport().request("agent.registry", refresh ? { refresh: true } : {});
			setEntries(list.entries);
			setStale(list.stale);
			setFailed(null);
		} catch (err) {
			setFailed(errorText(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (open) void load(false);
	}, [open, load]);

	const install = async (entry: AgentRegistryEntry) => {
		setInstallingId(entry.id);
		setInstallError(null);
		try {
			await getTransport().request("agent.install", { id: entry.id });
			await load(false);
		} catch (err) {
			setInstallError({ id: entry.id, message: errorText(err) });
		} finally {
			setInstallingId(null);
		}
	};

	const needle = query.trim().toLowerCase();
	const shown = (entries ?? []).filter(
		(e) =>
			needle.length === 0 ||
			`${e.id} ${e.name} ${e.description ?? ""}`.toLowerCase().includes(needle),
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				data-testid="agent-registry-dialog"
				className="flex h-[70vh] max-h-[80vh] w-full max-w-[40rem] flex-col gap-12"
			>
				<DialogHeader>
					<DialogTitle>Install an agent</DialogTitle>
					<DialogDescription>
						Agents published to the ACP registry. ThinkRail downloads one into its own directory,
						verifies its checksum, and pins the version it installed.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center gap-8">
					<Input
						data-testid="agent-registry-search"
						placeholder="Search agents"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
					<Button
						variant="outline"
						size="sm"
						data-testid="agent-registry-refresh"
						disabled={loading}
						onClick={() => void load(true)}
					>
						<RefreshCw className={`size-14 ${loading ? "animate-spin" : ""}`} />
						Refresh
					</Button>
				</div>

				{stale ? (
					<p
						data-testid="agent-registry-stale"
						className="flex items-center gap-4 text-feedback-warning tr-text-metadata"
					>
						<TriangleAlert className="size-14 shrink-0" />
						Couldn't reach the ACP registry — showing the last list ThinkRail fetched.
					</p>
				) : null}

				<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
					{failed !== null && entries === null ? (
						<p data-testid="agent-registry-error" className="text-text-muted tr-text-ui">
							Couldn't read the ACP registry — {failed}
						</p>
					) : entries === null ? (
						<p className="text-text-muted tr-text-ui">Loading the registry…</p>
					) : shown.length === 0 ? (
						<p className="text-text-muted tr-text-ui">No agent matches “{query.trim()}”.</p>
					) : (
						shown.map((entry) => (
							<RegistryRow
								key={entry.id}
								entry={entry}
								installing={installingId === entry.id}
								error={installError?.id === entry.id ? installError.message : null}
								onInstall={() => void install(entry)}
							/>
						))
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function RegistryRow({
	entry,
	installing,
	error,
	onInstall,
}: {
	entry: AgentRegistryEntry;
	installing: boolean;
	error: string | null;
	onInstall: () => void;
}) {
	const meta = [entry.version, entry.license].filter((part): part is string => Boolean(part));

	return (
		<div
			data-testid="agent-registry-row"
			data-agent={entry.id}
			data-installed={entry.installed}
			className="flex items-start gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8"
		>
			{entry.icon ? (
				<img
					src={entry.icon}
					alt=""
					className="mt-2 size-20 shrink-0 rounded-[var(--radius-sm)] bg-container-logo-chip-bg p-2"
				/>
			) : (
				<div className="mt-2 size-20 shrink-0" />
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<span className="truncate tr-text-ui text-text-default">{entry.name}</span>
				{entry.description ? (
					<span className="text-text-muted tr-text-metadata">{entry.description}</span>
				) : null}
				<span className="truncate text-text-subtle tr-text-metadata">{meta.join(" · ")}</span>
				{entry.notRecommended ? (
					<span
						data-testid="agent-registry-not-recommended"
						className="flex items-start gap-4 text-feedback-warning tr-text-metadata"
					>
						<TriangleAlert className="mt-2 size-14 shrink-0" />
						<span>Not recommended — {entry.notRecommended}</span>
					</span>
				) : null}
				{error ? (
					<span
						data-testid="agent-registry-install-error"
						className="text-feedback-error tr-text-metadata"
					>
						{error}
					</span>
				) : null}
			</div>
			{entry.installed ? (
				<span className="flex shrink-0 items-center gap-4 text-feedback-success tr-text-metadata">
					<Check className="size-14" />
					Installed
				</span>
			) : entry.distribution === null ? (
				<span
					data-testid="agent-registry-unavailable"
					className="shrink-0 text-text-muted tr-text-metadata"
				>
					Not built for this platform
				</span>
			) : (
				<Button
					variant="outline"
					size="sm"
					data-testid="agent-registry-install"
					data-agent={entry.id}
					disabled={installing}
					onClick={onInstall}
					className="shrink-0"
				>
					{installing ? (
						<Loader2 className="size-14 animate-spin" />
					) : (
						<Download className="size-14" />
					)}
					{installing ? "Installing…" : "Install"}
				</Button>
			)}
		</div>
	);
}
