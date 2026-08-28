import { RiCheckLine as Check } from "@remixicon/react";
import { DISCORD_APPLICATION_ID } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

function statusLine(status: ReturnType<typeof useAppStore.getState>["discordStatus"]): string {
	if (!status) return "Checking…";
	switch (status.state) {
		case "off":
			return "Off — nothing is sent to Discord.";
		case "unconfigured":
			return status.detail ?? "Add an application id to start publishing.";
		case "unavailable":
			return status.detail ?? "Couldn't reach Discord.";
		case "connecting":
			return "Connecting to Discord…";
		case "connected":
			if (!status.published) return status.detail ?? "Connected — nothing published right now.";
			return status.published.details
				? `On Discord: “${status.published.details}” — ${status.published.state}`
				: `On Discord: ${status.published.state}`;
	}
}

export function DiscordSettings() {
	const settings = useAppStore((s) => s.discordSettings);
	const status = useAppStore((s) => s.discordStatus);
	const projects = useAppStore((s) => s.projects);
	const [applicationIdDraft, setApplicationIdDraft] = useState(settings.applicationId);

	useEffect(() => setApplicationIdDraft(settings.applicationId), [settings.applicationId]);

	useEffect(() => {
		let cancelled = false;
		const poll = () => {
			getTransport()
				.request("discord.status", {})
				.then((next) => {
					if (!cancelled) useAppStore.getState().applyDiscordStatus(next);
				})
				.catch(() => {});
		};
		poll();
		const interval = setInterval(poll, 4000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, []);

	const update = (patch: Partial<typeof settings>) => {
		getTransport()
			.request("settings.update", { config: { discord: { ...settings, ...patch } } })
			.catch(() => toast.error("Couldn't change the Discord setting"));
	};

	const saveApplicationId = (next: string) => {
		setApplicationIdDraft(next);
		const trimmed = next.trim();
		if (trimmed === settings.applicationId) return;
		if (trimmed.length > 0 && !DISCORD_APPLICATION_ID.test(trimmed)) return;
		update({ applicationId: trimmed });
	};

	const toggleBlocked = (projectId: string) => {
		const blocked = settings.blockedProjectIds.includes(projectId)
			? settings.blockedProjectIds.filter((id) => id !== projectId)
			: [...settings.blockedProjectIds, projectId];
		update({ blockedProjectIds: blocked });
	};

	return (
		<section data-testid="settings-discord" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Discord Rich Presence</h3>
				<p className="text-text-muted tr-text-metadata">
					Shows the project and file you have open on your Discord profile. Off unless you turn it
					on; your choice is saved on the host and follows you across devices.
				</p>
			</div>

			<div className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8">
				<span className="tr-title-compact text-text-default">Discord Rich Presence</span>
				<button
					type="button"
					role="switch"
					aria-checked={settings.enabled}
					aria-label="Discord Rich Presence"
					data-testid="discord-toggle"
					data-active={settings.enabled}
					onClick={() => update({ enabled: !settings.enabled })}
					className={cn(
						"relative h-20 w-36 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
						settings.enabled ? "bg-primary" : "bg-border-default",
					)}
				>
					<span
						className={cn(
							"absolute top-2 left-2 size-16 rounded-full bg-container-workspace-bg transition-transform",
							settings.enabled && "translate-x-16",
						)}
					/>
				</button>
			</div>

			<p data-testid="discord-status" className="text-text-muted tr-text-metadata">
				{statusLine(status)}
			</p>

			<div className="flex flex-col gap-4">
				<span className="tr-title-compact text-text-default">Application id</span>
				<span className="text-text-muted tr-text-metadata">
					Discord always shows the name of the application publishing the presence, so it has to be
					one you registered at{" "}
					<span className="tr-code-text">discord.com/developers/applications</span>.
				</span>
				<input
					value={applicationIdDraft}
					onChange={(event) => setApplicationIdDraft(event.target.value)}
					onBlur={(event) => saveApplicationId(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") event.currentTarget.blur();
					}}
					spellCheck={false}
					inputMode="numeric"
					placeholder="1234567890123456789"
					aria-label="Discord application id"
					data-testid="discord-application-id"
					className="min-w-0 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none placeholder:text-text-subtle focus:border-primary"
				/>
			</div>

			<button
				type="button"
				data-testid="discord-share-filename-toggle"
				aria-pressed={settings.shareFileName}
				onClick={() => update({ shareFileName: !settings.shareFileName })}
				className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8 text-left"
			>
				<span className="flex flex-col gap-2">
					<span className="tr-title-compact text-text-default">Share the open file name</span>
					<span className="text-text-muted tr-text-metadata">
						Off shows the project only — never the path that leads to it.
					</span>
				</span>
				{settings.shareFileName ? <Check className="size-16 shrink-0 text-primary" /> : null}
			</button>

			{projects.length > 0 ? (
				<div className="flex flex-col gap-4">
					<span className="tr-title-compact text-text-default">Blocked projects</span>
					<span className="text-text-muted tr-text-metadata">
						A blocked project never reaches Discord, not even as an anonymous "working on
						something".
					</span>
					<div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-border-default bg-control-bg p-4">
						{projects.map((project) => {
							const blocked = settings.blockedProjectIds.includes(project.id);
							return (
								<button
									key={project.id}
									type="button"
									data-testid={`discord-block-${project.id}`}
									aria-pressed={blocked}
									onClick={() => toggleBlocked(project.id)}
									className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] px-8 py-4 text-left hover:bg-control-bg-hovered"
								>
									<span className="tr-text-ui text-text-default">{project.name}</span>
									<span
										className={cn(
											"flex size-16 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border",
											blocked
												? "border-primary bg-primary text-text-on-primary"
												: "border-border-default text-transparent",
										)}
									>
										<Check className="size-12" />
									</span>
								</button>
							);
						})}
					</div>
				</div>
			) : null}
		</section>
	);
}
