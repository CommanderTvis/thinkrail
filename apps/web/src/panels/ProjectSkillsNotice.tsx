import { RiShieldCheckLine as ShieldCheck, RiAlertLine as TriangleAlert } from "@remixicon/react";
import type { Project } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useEffect, useState } from "react";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

export function ProjectSkillsNotice({ projectId }: { projectId: string }) {
	const t = useT();
	const project = useAppStore((s) => s.projects.find((p) => p.id === projectId));
	const [aliasSkills, setAliasSkills] = useState<string[] | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setAliasSkills(null);
		getTransport()
			.request("project.aliasSkills", { projectId })
			.then((names) => {
				if (!cancelled) setAliasSkills(names);
			})
			.catch(() => {
				if (!cancelled) setAliasSkills([]);
			});
		return () => {
			cancelled = true;
		};
	}, [projectId]);

	if (!project || !aliasSkills || aliasSkills.length === 0) return null;

	const trusted = project.trusted === true;
	const acknowledged = new Set(project.acknowledgedSkills ?? []);
	const pending = trusted ? aliasSkills.filter((name) => !acknowledged.has(name)) : [];
	const count = aliasSkills.length;

	const applyProject = (updated: Project) => {
		useAppStore.getState().applyProjectUpdated(updated);
	};

	const run = async (request: () => Promise<Project>, failure: string) => {
		if (busy) return;
		setBusy(true);
		try {
			applyProject(await request());
		} catch (err) {
			toast.error(errorText(err), failure);
		} finally {
			setBusy(false);
		}
	};

	if (trusted && pending.length === 0) {
		return (
			<p
				data-testid="project-skills-notice"
				data-state="trusted"
				className="mt-16 flex items-center gap-4 text-text-muted tr-text-metadata"
			>
				<ShieldCheck className="size-14 shrink-0 text-feedback-warning" />
				{t("panels.projectTrust.skillsTrusted", { count })}
			</p>
		);
	}

	const isPending = trusted && pending.length > 0;
	return (
		<div
			data-testid="project-skills-notice"
			data-state={isPending ? "pending" : "untrusted"}
			className="mt-16 flex w-full max-w-[560px] items-center gap-8 rounded-sm border border-border-default border-l-[3px] border-l-feedback-warning bg-feedback-warning-subtle px-12 py-8 text-left"
		>
			<TriangleAlert className="size-16 shrink-0 text-feedback-warning" />
			<span className="min-w-0 flex-1 tr-text-ui text-text-default">
				{isPending
					? t("panels.projectTrust.newSkills", { count: pending.length })
					: t("panels.projectTrust.shipsSkills", { count })}
			</span>
			<Button
				size="m"
				data-testid={isPending ? "project-ack-button" : "project-trust-button"}
				disabled={busy}
				onClick={() =>
					void run(
						isPending
							? () =>
									getTransport().request("project.acknowledgeSkills", {
										id: projectId,
										names: pending,
									})
							: () => getTransport().request("project.setTrust", { id: projectId, trusted: true }),
						isPending
							? t("panels.projectTrust.acknowledgeFailed")
							: t("panels.projectTrust.trustFailed"),
					)
				}
			>
				{isPending ? t("panels.projectTrust.reviewAndEnable") : t("panels.projectTrust.trust")}
			</Button>
		</div>
	);
}
