import {
	RiStackLine as Boxes,
	RiCheckLine as Check,
	RiKeyLine as KeyRound,
	RiLockLine as Lock,
	RiLoginBoxLine as LogIn,
	RiLogoutBoxLine as LogOut,
	RiRefreshLine as RefreshCw,
	RiTerminalLine as TerminalIcon,
} from "@remixicon/react";
import type {
	AgentAuthMethod,
	AgentAuthResult,
	AgentProviderInfo,
	AgentProvidersReport,
	InstalledAgent,
} from "@thinkrail/contracts";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { selectHasAnyWorkspace, selectWorkspaceById, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { JetBrainsAiCard } from "./JetBrainsAiCard";

const PROVIDER_VISIBLE = 6;

const AUTH_KIND_ICON = { agent: LogIn, envVar: KeyRound, terminal: TerminalIcon } as const;

export function AgentProviderSetup({ agent }: { agent: InstalledAgent }) {
	const [report, setReport] = useState<AgentProvidersReport | null>(null);
	const [authMethods, setAuthMethods] = useState<AgentAuthMethod[]>([]);
	const [dataFailed, setDataFailed] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [showAllProviders, setShowAllProviders] = useState(false);
	const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
	const [busyMethodId, setBusyMethodId] = useState<string | null>(null);
	const dataGeneration = useRef(0);
	const agentId = agent.id;

	const loadData = useCallback(async (id: string) => {
		const mine = ++dataGeneration.current;
		setRefreshing(true);
		try {
			const [providers, methods] = await Promise.all([
				getTransport().request("agent.providers", { agentId: id }),
				getTransport().request("agent.authMethods", { agentId: id }),
			]);
			if (dataGeneration.current !== mine) return;
			setReport(providers);
			setAuthMethods(methods);
			setDataFailed(false);
		} catch {
			if (dataGeneration.current !== mine) return;
			setReport(null);
			setAuthMethods([]);
			setDataFailed(true);
		} finally {
			if (dataGeneration.current === mine) setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		void loadData(agentId);
	}, [agentId, loadData]);

	const finishAuth = useCallback(
		(result: AgentAuthResult, methodName: string) => {
			if (result.outcome === "ok") {
				void loadData(agentId);
				return;
			}
			if (result.outcome === "failed") {
				toast.error(result.error, `Couldn't connect ${methodName}`);
				return;
			}
			const store = useAppStore.getState();
			const workspace = selectWorkspaceById(store, result.workspaceId);
			if (!workspace) {
				toast.info(`Sign-in continues in a terminal in workspace ${result.workspaceId}.`);
				return;
			}
			store.activateWorkspace(workspace);
			store.addTerminal(
				result.workspaceId,
				undefined,
				undefined,
				"center",
				true,
				result.terminalId,
			);
			store.closeSettings();
		},
		[agentId, loadData],
	);

	const authenticate = useCallback(
		async (method: AgentAuthMethod, env?: Record<string, string>) => {
			setBusyMethodId(method.id);
			try {
				const result = await getTransport().request("agent.authenticate", {
					agentId,
					methodId: method.id,
					...(env ? { env } : {}),
				});
				finishAuth(result, method.name);
			} catch (err) {
				toast.error(errorText(err), `Couldn't connect ${method.name}`);
			} finally {
				setBusyMethodId(null);
			}
		},
		[agentId, finishAuth],
	);

	const logout = useCallback(
		async (provider: AgentProviderInfo) => {
			setBusyProviderId(provider.id);
			try {
				await getTransport().request("agent.logout", { agentId, methodId: provider.id });
			} catch (err) {
				toast.error(errorText(err), "Couldn't sign out");
				return;
			} finally {
				setBusyProviderId(null);
			}
			void loadData(agentId);
		},
		[agentId, loadData],
	);

	const caps = agent.capabilities;
	const showAuth = caps?.authentication ?? true;
	const showLogout = caps?.logout ?? true;
	const showProviderConfig = caps?.providerConfig ?? true;
	const jbCentral =
		report?.jbcentral !== undefined && report.jbcentralInstall !== undefined
			? { status: report.jbcentral, install: report.jbcentralInstall }
			: null;

	const hasWorkspace = useAppStore(selectHasAnyWorkspace);

	const providers = report?.providers ?? [];
	const configured = providers.filter((p) => p.configured);
	const unconfigured = providers.filter((p) => !p.configured);
	const shownUnconfigured = showAllProviders
		? unconfigured
		: unconfigured.slice(0, PROVIDER_VISIBLE);
	const hiddenProviderCount = unconfigured.length - shownUnconfigured.length;

	const nothingToShow = !showAuth && !showProviderConfig && jbCentral === null && !dataFailed;

	return (
		<div data-testid="settings-providers" data-agent={agentId} className="flex flex-col gap-16">
			<div className="flex items-start justify-between gap-8">
				<div className="flex flex-col gap-4">
					<h4 className="tr-title-compact text-text-default">Model providers</h4>
					<p className="text-text-muted tr-text-metadata">
						Subscription or API key — connect at least one.
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					data-testid="providers-refresh"
					aria-label="Refresh provider status"
					title="Refresh"
					disabled={refreshing}
					onClick={() => void loadData(agentId)}
				>
					<RefreshCw className={`size-14 ${refreshing ? "animate-spin" : ""}`} />
					Refresh
				</Button>
			</div>

			{dataFailed ? (
				<p data-testid="providers-error" className="text-text-muted tr-text-ui">
					Couldn't read {agent.name}'s provider status — try Refresh.
				</p>
			) : report == null ? (
				<p className="text-text-muted tr-text-ui">Loading providers…</p>
			) : (
				<>
					{showProviderConfig && configured.length > 0 ? (
						<Group title="Connected">
							{configured.map((p) => (
								<ConnectedRow
									key={p.id}
									provider={p}
									busy={busyProviderId === p.id}
									canLogout={showLogout}
									onSignOut={() => void logout(p)}
								/>
							))}
						</Group>
					) : null}

					{showAuth && authMethods.length > 0 ? (
						<Group title="Sign in">
							{authMethods.map((method) => (
								<AuthMethodRow
									key={method.id}
									method={method}
									busy={busyMethodId === method.id}
									hasWorkspace={hasWorkspace}
									satisfied={report?.anyConfigured ?? false}
									onConnect={(env) => void authenticate(method, env)}
								/>
							))}
						</Group>
					) : null}

					{jbCentral ? (
						<JetBrainsAiCard
							status={jbCentral.status}
							install={jbCentral.install}
							onChanged={() => loadData(agentId)}
						/>
					) : null}

					{showProviderConfig && unconfigured.length > 0 ? (
						<Group title="Not configured">
							{shownUnconfigured.map((p) => (
								<UnconfiguredRow key={p.id} provider={p} />
							))}
							{hiddenProviderCount > 0 ? (
								<Button
									variant="ghost"
									size="sm"
									data-testid="providers-show-more"
									onClick={() => setShowAllProviders(true)}
									className="self-start"
								>
									Show {hiddenProviderCount} more
								</Button>
							) : null}
						</Group>
					) : null}

					{nothingToShow ? (
						<p className="text-text-muted tr-text-metadata">
							{agent.name} has nothing to configure here.
						</p>
					) : null}
				</>
			)}
		</div>
	);
}

function Group({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-8">
			<h4 className="tr-text-eyebrow text-text-muted">{title}</h4>
			<div className="flex flex-col gap-4">{children}</div>
		</section>
	);
}

function ConnectedRow({
	provider,
	busy,
	canLogout,
	onSignOut,
}: {
	provider: AgentProviderInfo;
	busy: boolean;
	canLogout: boolean;
	onSignOut: () => void;
}) {
	return (
		<div
			data-testid="provider-row"
			data-provider={provider.id}
			data-configured="true"
			className="flex items-center gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8"
		>
			<span className="flex size-32 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-feedback-success-subtle text-feedback-success">
				<Check className="size-16" />
			</span>
			<div className="flex min-w-0 flex-col">
				<span className="truncate tr-text-ui text-text-default">
					{provider.name ?? provider.id}
				</span>
				<span className="truncate text-text-muted tr-text-metadata">
					{provider.protocols.join(" · ") || "configured"}
				</span>
			</div>
			{canLogout ? (
				<Button
					variant="outline"
					size="sm"
					data-testid="provider-signout"
					data-provider={provider.id}
					disabled={busy}
					onClick={onSignOut}
					className="ml-auto"
				>
					<LogOut className="size-14" />
					Sign out
				</Button>
			) : (
				<span
					className="ml-auto flex shrink-0 items-center gap-4 text-text-muted tr-text-metadata"
					title="This agent doesn't offer signing out in-app"
				>
					<Lock className="size-12" />
					Managed
				</span>
			)}
		</div>
	);
}

function UnconfiguredRow({ provider }: { provider: AgentProviderInfo }) {
	return (
		<div
			data-testid="provider-row"
			data-provider={provider.id}
			data-configured="false"
			className="flex items-center gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8"
		>
			<span className="flex size-32 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-control-bg-selected text-text-muted">
				<Boxes className="size-16" />
			</span>
			<div className="flex min-w-0 flex-col">
				<span className="truncate tr-text-ui text-text-default">
					{provider.name ?? provider.id}
				</span>
				<span className="truncate text-text-muted tr-text-metadata">
					{provider.protocols.join(" · ") || "not configured"}
				</span>
			</div>
			{provider.required ? (
				<span className="ml-auto shrink-0 text-feedback-warning tr-text-metadata">Required</span>
			) : null}
		</div>
	);
}

function AuthMethodRow({
	method,
	busy,
	hasWorkspace,
	satisfied,
	onConnect,
}: {
	method: AgentAuthMethod;
	busy: boolean;
	hasWorkspace: boolean;
	satisfied: boolean;
	onConnect: (env?: Record<string, string>) => void;
}) {
	const blocked = method.kind === "terminal" && !hasWorkspace;
	const [open, setOpen] = useState(false);
	const [values, setValues] = useState<Record<string, string>>({});
	const Icon = AUTH_KIND_ICON[method.kind];

	const submitEnvVars = () => {
		const env: Record<string, string> = {};
		for (const field of method.envVars ?? []) {
			const value = values[field.name]?.trim();
			if (value) env[field.name] = value;
		}
		onConnect(env);
	};

	return (
		<div
			data-testid="auth-method-row"
			data-method={method.id}
			className="flex flex-col gap-4 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8"
		>
			<div className="flex items-center gap-8 tr-text-ui">
				<span className="flex size-32 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-control-bg-selected text-text-muted">
					<Icon className="size-16" />
				</span>
				<div className="min-w-0 flex-1">
					<span className="block truncate text-text-default">{method.name}</span>
					{method.description ? (
						<span className="block truncate text-text-muted tr-text-metadata">
							{method.description}
						</span>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-4">
					{method.kind === "envVar" ? (
						<Button
							variant={satisfied ? "outline" : "default"}
							size="sm"
							data-testid="auth-method-connect"
							data-method={method.id}
							disabled={busy}
							onClick={() => setOpen((v) => !v)}
						>
							<KeyRound className="size-14" />
							Add key
						</Button>
					) : (
						<Button
							variant={satisfied ? "outline" : "default"}
							size="sm"
							data-testid="auth-method-connect"
							data-method={method.id}
							disabled={busy || blocked}
							title={
								blocked ? "Open a project first — this sign-in runs in a terminal." : undefined
							}
							onClick={() => onConnect()}
						>
							<Icon className="size-14" />
							Connect
						</Button>
					)}
				</div>
			</div>

			{blocked ? (
				<p data-testid="auth-method-blocked" className="text-text-muted tr-text-metadata">
					Open a project first — this sign-in runs in a terminal.
				</p>
			) : null}

			{open && method.kind === "envVar" ? (
				<div className="flex flex-col gap-4 pl-[calc(2rem+var(--space-8))]">
					{(method.envVars ?? []).map((field) => {
						const inputId = `${method.id}-${field.name}`;
						return (
							<div key={field.name} className="flex flex-col gap-2">
								<label htmlFor={inputId} className="text-text-muted tr-text-metadata">
									{field.label ?? field.name}
									{field.optional ? " (optional)" : ""}
								</label>
								<Input
									id={inputId}
									type={field.secret !== false ? "password" : "text"}
									data-testid="auth-method-env-input"
									value={values[field.name] ?? ""}
									onChange={(e) =>
										setValues((current) => ({ ...current, [field.name]: e.target.value }))
									}
								/>
							</div>
						);
					})}
					<div className="flex items-center gap-4">
						<Button
							size="sm"
							data-testid="auth-method-envvar-submit"
							disabled={busy}
							onClick={submitEnvVars}
						>
							Connect
						</Button>
						<Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
							Cancel
						</Button>
					</div>
				</div>
			) : null}

			{method.link ? (
				<a
					href={method.link}
					target="_blank"
					rel="noreferrer"
					className="pl-[calc(2rem+var(--space-8))] text-primary tr-text-metadata hover:underline"
				>
					{method.link}
				</a>
			) : null}
		</div>
	);
}
