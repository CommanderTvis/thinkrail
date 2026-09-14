import { RiCheckLine as Check } from "@remixicon/react";
import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import { cn } from "@thinkrail/plugin-ui";
import { useEffect, useState } from "react";
import type { DiscordStatus, discordContract } from "../contracts";
import { DISCORD_APPLICATION_ID, THINKRAIL_DISCORD_APPLICATION_ID } from "../webValues";

function statusLine(status: DiscordStatus | null): string {
	if (!status) return "Checking…";
	switch (status.state) {
		case "unconfigured":
			return status.detail ?? "Add an application id to start publishing.";
		case "unavailable":
			return status.detail ?? "Couldn't reach Discord.";
		case "connecting":
			return "Connecting to Discord…";
		case "connected":
			if (!status.published) return status.detail ?? "Connected — nothing published right now.";
			return status.published.details
				? `On Discord: "${status.published.details}" — ${status.published.state}`
				: `On Discord: ${status.published.state}`;
	}
}

export function createDiscordSettings(ctx: PluginWebContext<typeof discordContract>) {
	return function DiscordSettings() {
		const raw = ctx.useSettings();
		const applicationId = raw.applicationId ?? THINKRAIL_DISCORD_APPLICATION_ID;
		const blockedProjectIds = raw.blockedProjectIds ?? [];
		const shareFileName = raw.shareFileName ?? true;
		const projects = ctx.useHost((host) => host.projects);
		const [status, setStatus] = useState<DiscordStatus | null>(null);
		const [applicationIdDraft, setApplicationIdDraft] = useState(applicationId);

		useEffect(() => setApplicationIdDraft(applicationId), [applicationId]);

		useEffect(() => ctx.subscribe("status", setStatus, {}), []);

		const update = (patch: Partial<typeof raw>) => {
			ctx
				.patchSettings(patch)
				.catch(() => ctx.notify("error", "Couldn't change the Discord setting"));
		};

		const saveApplicationId = (next: string) => {
			setApplicationIdDraft(next);
			const trimmed = next.trim();
			if (trimmed === applicationId) return;
			if (trimmed.length > 0 && !DISCORD_APPLICATION_ID.test(trimmed)) return;
			update({ applicationId: trimmed });
		};

		const toggleBlocked = (projectId: string) => {
			const blocked = blockedProjectIds.includes(projectId)
				? blockedProjectIds.filter((id) => id !== projectId)
				: [...blockedProjectIds, projectId];
			update({ blockedProjectIds: blocked });
		};

		return (
			<section data-testid="settings-discord" className="flex flex-col gap-16">
				<div className="flex flex-col gap-4">
					<h3 className="tr-title-section text-text-default">Discord Rich Presence</h3>
					<p className="text-text-muted tr-text-metadata">
						Shows the project and file you have open on your Discord profile. Turn the Discord
						plugin on in Settings › Plugins to start; your choice here is saved on the host and
						follows you across devices.
					</p>
				</div>

				<p data-testid="discord-status" className="text-text-muted tr-text-metadata">
					{statusLine(status)}
				</p>

				<div className="flex flex-col gap-4">
					<span className="tr-title-compact text-text-default">Application id</span>
					<span className="text-text-muted tr-text-metadata">
						Discord always shows the name of the application publishing the presence. ThinkRail's
						own is filled in; replace it with one you registered at{" "}
						<span className="tr-code-text">discord.com/developers/applications</span> to publish
						under your own name and artwork.
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
					aria-pressed={shareFileName}
					onClick={() => update({ shareFileName: !shareFileName })}
					className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8 text-left"
				>
					<span className="flex flex-col gap-2">
						<span className="tr-title-compact text-text-default">Share the open file name</span>
						<span className="text-text-muted tr-text-metadata">
							Off shows the project only — never the path that leads to it.
						</span>
					</span>
					{shareFileName ? <Check className="size-16 shrink-0 text-primary" /> : null}
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
								const blocked = blockedProjectIds.includes(project.id);
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
	};
}
