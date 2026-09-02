import type { BlueprintAgentId, BlueprintSource } from "@thinkrail/contracts";
import { useState } from "react";
import { ClaudeMark } from "@/components/ClaudeMark";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { BUILTIN_LAYOUT_PRESETS, collectWorkbenchCenterGroups } from "@/shell/layout";
import { applyLayoutPresetLocally } from "@/shell/layoutState";
import { embeddedHostKey, isDefaultWorkspace, toast, useAppStore } from "@/store";
import { createSessionWithSkillBaseline, errorText, getTransport } from "@/transport";
import { openBlueprintPair } from "./blueprintOpen";
import { CHIP, CHIP_DISABLED, CHIP_OFF, CHIP_ON } from "./chips";

const BLUEPRINT_TERMINAL_TAB_KEY = "blueprint-author";

const SOURCES = [
	{ kind: "idea" as const, label: "An idea" },
	{ kind: "product" as const, label: "This project" },
	{ kind: "spec" as const, label: "A document" },
];

/**
 * The brief buys a whole workspace: a worktree to build in, the agent that writes the spec, and the spec
 * beside it. The agent is the *author* — the reader talks to it directly. See panels/SPEC.md.
 */
export function BlueprintStartDialog({
	projectId,
	onOpenChange,
}: {
	projectId: string;
	onOpenChange: (open: boolean) => void;
}) {
	const claudeEnabled = useAppStore((s) => s.claudeCodeEnabled);
	const [brief, setBrief] = useState("");
	const [kind, setKind] = useState<BlueprintSource["kind"]>("idea");
	const [specPath, setSpecPath] = useState<string | null>(null);
	const [agentId, setAgentId] = useState<BlueprintAgentId>("pi");
	const [starting, setStarting] = useState(false);

	const source: BlueprintSource | null =
		kind === "idea"
			? brief.trim()
				? { kind: "idea", brief }
				: null
			: kind === "product"
				? { kind: "product" }
				: specPath
					? { kind: "spec", path: specPath }
					: null;

	const agents = [
		{ id: "pi" as const, label: "Bundled agent", available: true, reason: null },
		{
			id: "claude" as const,
			label: "Claude Code",
			available: claudeEnabled,
			reason: claudeEnabled ? null : "Turn Claude Code on in Settings.",
		},
	];
	const chosen = agents.find((agent) => agent.id === agentId);

	const pickSpec = async () => {
		try {
			const { path } = await getTransport().request("dialog.selectFile", {});
			if (path) setSpecPath(path);
		} catch (error) {
			toast.error(errorText(error), "Could not open the file picker");
		}
	};

	const start = async () => {
		setStarting(true);
		try {
			const transport = getTransport();
			// The project folder, not a cut worktree: a spec is written *before* there is anything to
			// isolate, and a branch named after a paragraph helps nobody. See panels/SPEC.md.
			const workspaces = await transport.request("workspace.list", { projectId });
			const workspace = workspaces.find(isDefaultWorkspace);
			if (!workspace) throw new Error("This host has no Default workspace for this project.");

			// One project folder, one spec. A second idea wants its own project, or its own worktree.
			const existing = await transport
				.request("blueprint.get", { workspaceId: workspace.id })
				.catch(() => null);
			if (existing) {
				useAppStore.getState().setWorkspaces(projectId, workspaces);
				useAppStore.getState().activateWorkspace(workspace);
				onOpenChange(false);
				await openBlueprintPair(workspace.id);
				return;
			}
			if (!source) throw new Error("Choose what this blueprint starts from.");
			const { state, opening, command } = await transport.request("blueprint.open", {
				workspaceId: workspace.id,
				source,
				agentId,
			});

			// Focus: one centre group, every side tool and the bottom region hidden. Drafting a spec is
			// not the moment for Files, Changes and a shell — see panels/SPEC.md.
			const focus = BUILTIN_LAYOUT_PRESETS.find((preset) => preset.id === "focus");
			if (focus) applyLayoutPresetLocally(focus);
			// `addTerminal` drops `targetArea` unless a group is named, and its default region is the
			// bottom — so the centre group has to be spelled out or the author lands under the document.
			const frame = useAppStore.getState().workbenchFrame;
			const centre = frame ? collectWorkbenchCenterGroups(frame.center)[0]?.id : undefined;

			const store = useAppStore.getState();
			store.setWorkspaceBlueprint(state);
			store.setWorkspaces(projectId, workspaces);
			store.activateWorkspace(workspace);
			onOpenChange(false);

			let authorHostKey: string;
			if (command) {
				store.addTerminal(
					workspace.id,
					command,
					centre,
					"center",
					true,
					BLUEPRINT_TERMINAL_TAB_KEY,
				);
				authorHostKey = embeddedHostKey("terminal", BLUEPRINT_TERMINAL_TAB_KEY);
				await transport.request("blueprint.setAuthor", {
					workspaceId: workspace.id,
					author: { kind: "terminal", tabKey: BLUEPRINT_TERMINAL_TAB_KEY },
				});
			} else {
				const { result: session, syncedTick } = await createSessionWithSkillBaseline({
					workspaceId: workspace.id,
				});
				store.openChatSession(
					workspace.id,
					session.sessionId,
					session.model,
					session.thinkingLevel,
					syncedTick,
				);
				authorHostKey = embeddedHostKey("chat", session.sessionId);
				await transport.request("blueprint.setAuthor", {
					workspaceId: workspace.id,
					author: { kind: "chat", sessionId: session.sessionId },
				});
				await transport.request("session.prompt", { sessionId: session.sessionId, text: opening });
			}

			// The author carries the specification beside it, as its embedded pane — see panels/SPEC.md.
			store.focusEmbeddedPane(workspace.id, authorHostKey, "blueprint");
		} catch (error) {
			toast.error(errorText(error), "Could not start the blueprint");
		} finally {
			setStarting(false);
		}
	};

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent data-testid="blueprint-start" className="max-w-[560px]">
				<DialogHeader>
					<DialogTitle>Draft a blueprint</DialogTitle>
					<DialogDescription>
						Start from an idea, or take over something that already exists. Either way you get a
						workspace with the agent on the left, writing a spec you can change on the right.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-wrap items-center gap-8">
					{SOURCES.map((option) => (
						<button
							key={option.kind}
							type="button"
							data-testid="blueprint-source"
							data-source={option.kind}
							data-selected={option.kind === kind || undefined}
							onClick={() => setKind(option.kind)}
							className={cn(CHIP, option.kind === kind ? CHIP_ON : CHIP_OFF)}
						>
							{option.label}
						</button>
					))}
				</div>

				{kind === "idea" ? (
					<Textarea
						autoFocus
						data-testid="blueprint-brief"
						value={brief}
						rows={3}
						placeholder="I want an app to control my lightbulbs."
						onChange={(event) => setBrief(event.target.value)}
					/>
				) : null}

				{kind === "product" ? (
					<p className="tr-text-metadata text-text-muted">
						The agent reads this project — its build files, entrypoints and configuration — and
						writes down the decisions it is already living by, each one a control you can change.
					</p>
				) : null}

				{kind === "spec" ? (
					<div className="flex items-center gap-8">
						<Button
							variant="outline"
							data-testid="blueprint-spec-pick"
							onClick={() => void pickSpec()}
						>
							Choose a document…
						</Button>
						<span
							data-testid="blueprint-spec-path"
							className="min-w-0 flex-1 truncate tr-text-metadata text-text-muted"
						>
							{specPath ?? "Any markdown file in this project. It is read, never rewritten."}
						</span>
					</div>
				) : null}

				<div className="flex flex-wrap items-center gap-8">
					{agents.map((agent) => (
						<button
							key={agent.id}
							type="button"
							data-testid="blueprint-agent"
							data-agent={agent.id}
							data-selected={agent.id === agentId || undefined}
							disabled={!agent.available}
							title={agent.reason ?? undefined}
							onClick={() => setAgentId(agent.id)}
							className={cn(
								CHIP,
								agent.id === agentId ? CHIP_ON : CHIP_OFF,
								!agent.available && CHIP_DISABLED,
							)}
						>
							{agent.id === "claude" ? <ClaudeMark className="size-14 shrink-0" /> : null}
							{agent.label}
						</button>
					))}
				</div>

				{chosen && !chosen.available ? (
					<p className="tr-text-metadata text-feedback-warning">{chosen.reason}</p>
				) : null}

				<div className="flex justify-end">
					<Button
						data-testid="blueprint-start-go"
						disabled={starting || source === null || !chosen?.available}
						onClick={() => void start()}
					>
						{starting ? "Starting…" : kind === "idea" ? "Draft it" : "Take it over"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
