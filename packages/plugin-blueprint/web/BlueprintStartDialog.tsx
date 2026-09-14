import type { AgentLauncher, PluginWebContext } from "@thinkrail/plugin-api/web";
import {
	Button,
	CHIP,
	CHIP_DISABLED,
	CHIP_OFF,
	CHIP_ON,
	cn,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Textarea,
} from "@thinkrail/plugin-ui";
import { useState } from "react";
import type { BlueprintAgentId, BlueprintSource, blueprintContract } from "../contracts";
import { createBlueprintOpener } from "./blueprintOpen";
import { useBlueprintStore } from "./store";

type Ctx = PluginWebContext<typeof blueprintContract>;

const BLUEPRINT_TERMINAL_TAB_KEY = "blueprint-author";

const SOURCES = [
	{ kind: "idea" as const, label: "An idea" },
	{ kind: "product" as const, label: "This project" },
	{ kind: "spec" as const, label: "A document" },
];

function LauncherAgentChip({
	launcher,
	selected,
	onSelect,
}: {
	launcher: AgentLauncher;
	selected: boolean;
	onSelect: () => void;
}) {
	const { available, reason } = launcher.useAvailable();
	const Icon = launcher.icon;
	return (
		<button
			type="button"
			data-testid="blueprint-agent"
			data-agent={launcher.id}
			data-selected={selected || undefined}
			disabled={!available}
			title={reason}
			onClick={onSelect}
			className={cn(CHIP, selected ? CHIP_ON : CHIP_OFF, !available && CHIP_DISABLED)}
		>
			<Icon className="size-14 shrink-0" />
			{launcher.label}
		</button>
	);
}

/**
 * The brief buys a whole workspace: a worktree to build in, the agent that writes the spec, and the spec
 * beside it. The agent is the *author* — the reader talks to it directly.
 *
 * The "claude" agent choice is whichever registered launcher of that id exists — nothing renders it
 * before one is.
 */
export function createBlueprintStartDialog(ctx: Ctx) {
	const { openBlueprintPair } = createBlueprintOpener(ctx);

	return function BlueprintStartDialog({
		projectId,
		onOpenChange,
	}: {
		projectId: string;
		onOpenChange: (open: boolean) => void;
	}) {
		const launchers = ctx.useLaunchers();
		const claudeLauncher = launchers.find((launcher) => launcher.id === "claude");
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

		const pickSpec = async () => {
			try {
				const path = await ctx.pickFile();
				if (path) setSpecPath(path);
			} catch (error) {
				ctx.notify(
					"error",
					"Could not open the file picker",
					error instanceof Error ? error.message : String(error),
				);
			}
		};

		const start = async () => {
			setStarting(true);
			try {
				const workspace = await ctx.enterDefaultWorkspace(projectId);
				if (!workspace) return;

				// One project folder, one spec. A second idea wants its own project, or its own worktree.
				const existing = await ctx
					.request("get", { workspaceId: workspace.id })
					.then((result) => result.state)
					.catch(() => null);
				if (existing) {
					useBlueprintStore.getState().setState(workspace.id, existing);
					onOpenChange(false);
					await openBlueprintPair(workspace.id);
					return;
				}
				if (!source) throw new Error("Choose what this blueprint starts from.");
				const { opening, systemPrompt } = await ctx.request("open", {
					workspaceId: workspace.id,
					source,
					agentId,
				});
				onOpenChange(false);

				if (agentId === "claude" && claudeLauncher) {
					const command = claudeLauncher.terminalCommand({ systemPrompt, initialPrompt: opening });
					await ctx.openTerminal(workspace.id, { command, tabKey: BLUEPRINT_TERMINAL_TAB_KEY });
					await ctx.request("setAuthor", {
						workspaceId: workspace.id,
						author: { kind: "terminal", tabKey: BLUEPRINT_TERMINAL_TAB_KEY },
					});
					ctx.focusCompanion(
						{ kind: "terminal", workspaceId: workspace.id, key: BLUEPRINT_TERMINAL_TAB_KEY },
						"blueprint",
					);
				} else {
					const { sessionId } = await ctx.openChat(workspace.id, { prompt: opening });
					await ctx.request("setAuthor", {
						workspaceId: workspace.id,
						author: { kind: "chat", sessionId },
					});
					ctx.focusCompanion(
						{ kind: "chat", workspaceId: workspace.id, key: sessionId },
						"blueprint",
					);
				}
			} catch (error) {
				ctx.notify(
					"error",
					"Could not start the blueprint",
					error instanceof Error ? error.message : String(error),
				);
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
						<button
							type="button"
							data-testid="blueprint-agent"
							data-agent="pi"
							data-selected={agentId === "pi" || undefined}
							onClick={() => setAgentId("pi")}
							className={cn(CHIP, agentId === "pi" ? CHIP_ON : CHIP_OFF)}
						>
							Bundled agent
						</button>
						{claudeLauncher ? (
							<LauncherAgentChip
								launcher={claudeLauncher}
								selected={agentId === "claude"}
								onSelect={() => setAgentId("claude")}
							/>
						) : null}
					</div>

					<div className="flex justify-end">
						<Button
							data-testid="blueprint-start-go"
							disabled={starting || source === null}
							onClick={() => void start()}
						>
							{starting ? "Starting…" : kind === "idea" ? "Draft it" : "Take it over"}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		);
	};
}
