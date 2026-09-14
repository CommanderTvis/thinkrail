import type { CompanionHost, CompanionRegistration } from "@thinkrail/plugin-api/web";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { type EmbeddedCompanion, EmbeddedSplit } from "@/components/EmbeddedSplit";
import { selectCompanions, usePluginRegistry } from "../plugins/registry";
import { embeddedHostKey, useAppStore } from "../store";

type PluginCompanion = CompanionRegistration & { pluginId: string };

const noTitle = (): null => null;

function CompanionProbe({
	registration,
	host,
	onAvailable,
	onTitle,
}: {
	registration: PluginCompanion;
	host: CompanionHost;
	onAvailable: (kind: string, available: boolean) => void;
	onTitle: (kind: string, title: string | null) => void;
}) {
	const available = registration.useAvailable(host);
	const useTitle = registration.useTitle ?? noTitle;
	const title = useTitle(host);
	useEffect(() => {
		onAvailable(registration.kind, available);
	}, [registration.kind, available, onAvailable]);
	useEffect(() => {
		onTitle(registration.kind, title);
	}, [registration.kind, title, onTitle]);
	return null;
}

export function Companions({ host, children }: { host: CompanionHost; children: ReactNode }) {
	const direction = useAppStore((state) => state.localLayoutPreferences.defaultPaneDirection);
	const registrations = usePluginRegistry((state) => selectCompanions(state, host.kind));
	const hostKey = embeddedHostKey(host.kind, host.key);
	const entry = useAppStore((state) => state.embeddedPanes[host.workspaceId]?.[hostKey]);

	const [availableByKind, setAvailableByKind] = useState<Record<string, boolean>>({});
	const reportAvailable = useCallback((kind: string, available: boolean) => {
		setAvailableByKind((current) =>
			current[kind] === available ? current : { ...current, [kind]: available },
		);
	}, []);
	const [titleByKind, setTitleByKind] = useState<Record<string, string | null>>({});
	const reportTitle = useCallback((kind: string, title: string | null) => {
		setTitleByKind((current) =>
			current[kind] === title ? current : { ...current, [kind]: title },
		);
	}, []);
	const registeredKinds = useMemo(() => new Set(registrations.map((r) => r.kind)), [registrations]);
	useEffect(() => {
		setAvailableByKind((current) => {
			const next: Record<string, boolean> = {};
			let changed = false;
			for (const [kind, available] of Object.entries(current)) {
				if (registeredKinds.has(kind)) next[kind] = available;
				else changed = true;
			}
			return changed ? next : current;
		});
		setTitleByKind((current) => {
			const next: Record<string, string | null> = {};
			let changed = false;
			for (const [kind, title] of Object.entries(current)) {
				if (registeredKinds.has(kind)) next[kind] = title;
				else changed = true;
			}
			return changed ? next : current;
		});
	}, [registeredKinds]);

	const order = entry?.focus
		? [entry.focus, ...registrations.map((r) => r.kind).filter((kind) => kind !== entry.focus)]
		: registrations.map((r) => r.kind);
	const byKind = new Map(registrations.map((r) => [r.kind, r]));
	const shown =
		order
			.map((kind) => byKind.get(kind))
			.find(
				(r): r is PluginCompanion =>
					r !== undefined && availableByKind[r.kind] === true && entry?.hidden?.[r.kind] !== true,
			) ?? null;
	const folded = registrations.filter(
		(r) => availableByKind[r.kind] === true && r.kind !== shown?.kind,
	);

	const hide = (kind: string) =>
		useAppStore.getState().setEmbeddedPaneHidden(host.workspaceId, hostKey, kind, true);
	const chipTestId = host.kind === "terminal" ? "terminal-embedded-chip" : "chat-embedded-chip";
	const titleFor = (registration: PluginCompanion): string =>
		titleByKind[registration.kind] ?? registration.title;
	const companion: EmbeddedCompanion | null = shown
		? {
				title: titleFor(shown),
				content: <shown.component key={shown.pluginId} host={host} />,
				onClose: () => hide(shown.kind),
			}
		: null;

	return (
		<>
			<EmbeddedSplit direction={direction} companion={companion}>
				<div className="relative h-full min-h-0">
					{children}
					{folded.length > 0 ? (
						<div className="absolute right-12 bottom-8 z-20 flex items-center gap-4">
							{folded.map((registration) => (
								<button
									key={registration.pluginId}
									type="button"
									data-testid={chipTestId}
									data-kind={registration.kind}
									title={`Show the ${titleFor(registration).toLowerCase()}`}
									onClick={() =>
										useAppStore
											.getState()
											.focusEmbeddedPane(host.workspaceId, hostKey, registration.kind)
									}
									className="flex shrink-0 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] bg-container-elevated-bg px-4 tr-text-label-pill text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
								>
									<registration.icon className="size-12 shrink-0" />
									<span className="max-w-[10rem] truncate">{titleFor(registration)}</span>
								</button>
							))}
						</div>
					) : null}
				</div>
			</EmbeddedSplit>
			{registrations.map((registration) => (
				<CompanionProbe
					key={registration.pluginId}
					registration={registration}
					host={host}
					onAvailable={reportAvailable}
					onTitle={reportTitle}
				/>
			))}
		</>
	);
}
