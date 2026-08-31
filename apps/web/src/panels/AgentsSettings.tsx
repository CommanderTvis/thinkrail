import {
	RiRobotLine as Bot,
	RiCheckLine as Check,
	RiArchiveLine as Package,
	RiAddLine as Plus,
	RiRefreshLine as RefreshCw,
	RiDeleteBin6Line as Trash2,
	RiAlertLine as TriangleAlert,
} from "@remixicon/react";
import type { DetectedAgent, InstalledAgent } from "@thinkrail/contracts";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib";
import { selectResolvedAgentId, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { AgentCommandEditor } from "./AgentCommandEditor";
import { AgentProviderSetup } from "./AgentProviderSetup";
import { AgentRegistryDialog } from "./AgentRegistryDialog";
import { pickSelectedAgentId, sortInstalledAgents } from "./agentsModel";
import { ConfirmPopover } from "./ConfirmPopover";

const ORIGIN_LABEL = {
	bundled: "Bundled with ThinkRail",
	installed: "Installed from the ACP registry",
	external: "Launched from this machine",
} as const;

export function AgentsSettings() {
	const [agents, setAgents] = useState<InstalledAgent[] | null>(null);
	const [agentsFailed, setAgentsFailed] = useState(false);
	const [detected, setDetected] = useState<DetectedAgent[]>([]);
	const [detectFailed, setDetectFailed] = useState(false);
	const [scanning, setScanning] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [addingId, setAddingId] = useState<string | null>(null);
	const [registryOpen, setRegistryOpen] = useState(false);
	const agentChangeTick = useAppStore((s) => s.agentChangeTick);
	const defaultAgentId = useAppStore((s) => selectResolvedAgentId(s, null));
	const generation = useRef(0);

	const load = useCallback(async () => {
		const mine = ++generation.current;
		setScanning(true);
		try {
			const list = await getTransport().request("agent.list", {});
			if (generation.current !== mine) return;
			setAgents(sortInstalledAgents(list));
			setAgentsFailed(false);
			setSelectedId((current) => pickSelectedAgentId(list, current, defaultAgentId));
		} catch {
			if (generation.current !== mine) return;
			setAgentsFailed(true);
		}
		try {
			const found = await getTransport().request("agent.detect", {});
			if (generation.current !== mine) return;
			setDetected(found);
			setDetectFailed(false);
		} catch {
			if (generation.current !== mine) return;
			setDetected([]);
			setDetectFailed(true);
		} finally {
			if (generation.current === mine) setScanning(false);
		}
	}, [defaultAgentId]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (agentChangeTick > 0) void load();
	}, [agentChangeTick, load]);

	const add = async (found: DetectedAgent) => {
		setAddingId(found.id);
		try {
			const added = await getTransport().request("agent.add", {
				id: found.id,
				name: found.name,
				command: found.command,
				args: found.args,
			});
			setSelectedId(added.id);
		} catch (err) {
			toast.error(errorText(err), `Couldn't add ${found.name}`);
		} finally {
			setAddingId(null);
		}
		await load();
	};

	const remove = async (agent: InstalledAgent) => {
		try {
			await getTransport().request("agent.remove", { id: agent.id });
			setSelectedId(null);
		} catch (err) {
			toast.error(errorText(err), `Couldn't remove ${agent.name}`);
		}
		await load();
	};

	const makeDefault = (agent: InstalledAgent) => {
		getTransport()
			.request("settings.update", { config: { defaultAgentId: agent.id } })
			.catch((err) => toast.error(errorText(err), "Couldn't change the default agent"));
	};

	const selected = agents?.find((a) => a.id === selectedId) ?? null;

	return (
		<div data-testid="settings-agents" className="flex flex-col gap-16 md:flex-row">
			<div className="flex shrink-0 flex-col gap-16 md:sticky md:top-0 md:w-[12rem] md:self-start">
				<Group title="Agents">
					{agentsFailed && agents === null ? (
						<p data-testid="agents-error" className="text-text-muted tr-text-metadata">
							Couldn't read the installed agents from the host.
						</p>
					) : agents === null ? (
						<p className="text-text-muted tr-text-metadata">Loading agents…</p>
					) : (
						agents.map((agent) => (
							<AgentRow
								key={agent.id}
								agent={agent}
								active={agent.id === selectedId}
								isDefault={agent.id === defaultAgentId}
								onSelect={() => setSelectedId(agent.id)}
							/>
						))
					)}
				</Group>

				<Group
					title="Found on your machine"
					action={
						<Button
							variant="ghost"
							size="sm"
							data-testid="agents-rescan"
							aria-label="Rescan this machine for agents"
							title="Rescan"
							disabled={scanning}
							onClick={() => void load()}
						>
							<RefreshCw className={cn("size-14", scanning && "animate-spin")} />
						</Button>
					}
				>
					{detectFailed ? (
						<p data-testid="agents-detect-error" className="text-text-muted tr-text-metadata">
							Couldn't scan this machine for agents — try Rescan.
						</p>
					) : detected.length === 0 ? (
						<p className="text-text-muted tr-text-metadata">
							No unlisted ACP agent found on this machine.
						</p>
					) : (
						detected.map((found) => (
							<DetectedRow
								key={found.id}
								found={found}
								busy={addingId === found.id}
								onAdd={() => void add(found)}
							/>
						))
					)}
				</Group>

				<Button
					variant="outline"
					size="sm"
					data-testid="agents-install-new"
					onClick={() => setRegistryOpen(true)}
				>
					<Package className="size-14" />
					Install new…
				</Button>
			</div>

			<div className="min-w-0 flex-1 md:border-border-default md:border-l md:pl-16">
				{selected === null ? (
					<p className="text-text-muted tr-text-ui">
						{agents?.length === 0
							? "No agent is installed. Add one found on your machine, or install one from the ACP registry."
							: "Select an agent."}
					</p>
				) : (
					<div key={selected.id} className="flex flex-col gap-16">
						<header className="flex items-start gap-12">
							<div className="flex min-w-0 flex-1 flex-col gap-2">
								<h3 className="truncate tr-title-section text-text-default">{selected.name}</h3>
								<span className="text-text-muted tr-text-metadata">
									{ORIGIN_LABEL[selected.origin]}
									{selected.version ? ` · ${selected.version}` : ""}
								</span>
							</div>
							{selected.id === defaultAgentId ? (
								<span
									data-testid="agent-is-default"
									className="flex shrink-0 items-center gap-4 rounded-full border border-border-default px-8 py-2 tr-text-label-pill text-text-muted"
								>
									<Check className="size-12" />
									Default
								</span>
							) : (
								<Button
									variant="outline"
									size="sm"
									data-testid="agent-make-default"
									className="shrink-0"
									onClick={() => makeDefault(selected)}
								>
									Use by default
								</Button>
							)}
						</header>

						{selected.unavailable ? (
							<p
								data-testid="agent-unavailable"
								className="flex items-start gap-4 rounded-[var(--radius-sm)] border border-border-default border-l-[3px] border-l-feedback-warning bg-feedback-warning-subtle px-12 py-8 text-text-default tr-text-metadata"
							>
								<TriangleAlert className="size-14 shrink-0 text-feedback-warning" />
								{selected.unavailable}
							</p>
						) : null}

						<AgentCommandEditor agent={selected} />

						<AgentProviderSetup agent={selected} />

						{selected.origin === "bundled" ? null : (
							<RemoveAgentButton agent={selected} onConfirm={() => void remove(selected)} />
						)}
					</div>
				)}
			</div>

			<AgentRegistryDialog open={registryOpen} onOpenChange={setRegistryOpen} />
		</div>
	);
}

function RemoveAgentButton({ agent, onConfirm }: { agent: InstalledAgent; onConfirm: () => void }) {
	const [open, setOpen] = useState(false);
	return (
		<ConfirmPopover
			open={open}
			onOpenChange={setOpen}
			title={`Remove ${agent.name}?`}
			description="ThinkRail stops offering this agent. Chats already recorded are kept."
			confirmLabel="Remove"
			destructive
			confirmTestId="agent-confirm-remove"
			onConfirm={onConfirm}
			align="start"
		>
			<PopoverTrigger asChild>
				<Button variant="outline" size="sm" data-testid="agent-remove" className="self-start">
					<Trash2 className="size-14" />
					Remove agent
				</Button>
			</PopoverTrigger>
		</ConfirmPopover>
	);
}

function Group({
	title,
	action,
	children,
}: {
	title: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-8">
			<div className="flex items-center justify-between gap-4">
				<h4 className="tr-text-eyebrow text-text-muted">{title}</h4>
				{action}
			</div>
			<div className="flex flex-col gap-4">{children}</div>
		</section>
	);
}

function AgentRow({
	agent,
	active,
	isDefault,
	onSelect,
}: {
	agent: InstalledAgent;
	active: boolean;
	isDefault: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			data-testid="agent-row"
			data-agent={agent.id}
			data-active={active}
			data-default={isDefault}
			onClick={onSelect}
			className="flex items-center gap-8 rounded-[var(--radius-sm)] border border-transparent px-8 py-4 text-left outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[active=true]:border-control-border-active data-[active=true]:bg-control-bg-selected"
		>
			{agent.icon && !agent.unavailable ? (
				<img
					src={agent.icon}
					alt=""
					className="size-16 shrink-0 rounded-[var(--radius-sm)] bg-container-logo-chip-bg p-px"
				/>
			) : (
				<Bot
					className={cn(
						"size-16 shrink-0",
						agent.unavailable ? "text-feedback-warning" : "text-text-muted",
					)}
				/>
			)}
			<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default">{agent.name}</span>
			{isDefault ? (
				<span className="shrink-0 tr-text-label-pill text-text-subtle">Default</span>
			) : null}
		</button>
	);
}

function DetectedRow({
	found,
	busy,
	onAdd,
}: {
	found: DetectedAgent;
	busy: boolean;
	onAdd: () => void;
}) {
	return (
		<div
			data-testid="detected-agent-row"
			data-agent={found.id}
			data-source={found.source}
			className="flex items-center gap-8 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4"
		>
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate tr-text-ui text-text-default">{found.name}</span>
				<span className="truncate text-text-muted tr-text-metadata" title={found.detail}>
					{found.detail}
				</span>
			</div>
			<Button
				size="sm"
				data-testid="detected-agent-add"
				data-agent={found.id}
				disabled={busy}
				onClick={onAdd}
				className="shrink-0"
			>
				<Plus className="size-14" />
				Add
			</Button>
		</div>
	);
}
