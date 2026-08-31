import { RiAlertLine as TriangleAlert } from "@remixicon/react";
import type { InstalledAgent } from "@thinkrail/contracts";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsSection, selectResolvedAgentId, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { agentBannerState, selectBannerAgent } from "./agentsModel";

export function AgentWarningBanner({ projectId }: { projectId: string | null }) {
	const [agents, setAgents] = useState<InstalledAgent[] | null>(null);
	const [providersConfigured, setProvidersConfigured] = useState<boolean | null>(null);
	const settingsOpen = useAppStore((s) => s.settingsOpen);
	const resolvedAgentId = useAppStore((s) => selectResolvedAgentId(s, projectId));

	const check = useCallback(async () => {
		let installed: InstalledAgent[];
		try {
			installed = await getTransport().request("agent.list", {});
		} catch {
			setAgents(null);
			return;
		}
		setAgents(installed);
		const agent = selectBannerAgent(installed, resolvedAgentId);
		if (!agent) {
			setProvidersConfigured(null);
			return;
		}
		try {
			const report = await getTransport().request("agent.providers", { agentId: agent.id });
			setProvidersConfigured(report.anyConfigured);
		} catch {
			setProvidersConfigured(null);
		}
	}, [resolvedAgentId]);

	useEffect(() => {
		if (!settingsOpen) void check();
	}, [check, settingsOpen]);

	const state = agentBannerState({ agents, resolvedAgentId, providersConfigured });

	if (state.kind === "none") return null;

	return (
		<Banner testId="welcome-agent-warning" state={state.reason}>
			<span className="min-w-0 flex-1 tr-text-reading text-text-default">No agent connected.</span>
			<Action testId="welcome-connect-agent" label="Set up an agent" />
		</Banner>
	);
}

function Banner({
	testId,
	state,
	children,
}: {
	testId: string;
	state: string;
	children: ReactNode;
}) {
	return (
		<div
			data-testid={testId}
			data-state={state}
			className="mt-16 flex w-full max-w-[560px] items-center gap-8 rounded-[var(--radius-sm)] border border-border-default border-l-[3px] border-l-feedback-warning bg-feedback-warning-subtle px-12 py-8 text-left"
		>
			<TriangleAlert className="size-16 shrink-0 text-feedback-warning" />
			{children}
		</div>
	);
}

function Action({ testId, label }: { testId: string; label: string }) {
	return (
		<Button
			size="sm"
			data-testid={testId}
			onClick={() => useAppStore.getState().openSettings(SettingsSection.Agents)}
			className="shrink-0"
		>
			{label}
		</Button>
	);
}
