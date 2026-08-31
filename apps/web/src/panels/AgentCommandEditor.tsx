import { RiFolderOpenLine as FolderOpen, RiLockLine as Lock } from "@remixicon/react";
import type { InstalledAgent } from "@thinkrail/contracts";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/store";
import { errorText, getTransport } from "@/transport";
import { formatAgentArgs, parseAgentArgs } from "./agentsModel";

export function AgentCommandEditor({ agent }: { agent: InstalledAgent }) {
	const [command, setCommand] = useState(agent.command);
	const [argsText, setArgsText] = useState(formatAgentArgs(agent.args));
	const [saving, setSaving] = useState(false);
	const [browsing, setBrowsing] = useState(false);

	const args = parseAgentArgs(argsText);
	const trimmed = command.trim();
	const dirty = trimmed !== agent.command || formatAgentArgs(args) !== formatAgentArgs(agent.args);

	const browse = async () => {
		setBrowsing(true);
		try {
			const { path } = await getTransport().request("dialog.selectFile", {});
			if (path) setCommand(path);
		} catch (err) {
			toast.error(errorText(err), "Couldn't open the file picker");
		} finally {
			setBrowsing(false);
		}
	};

	const save = async () => {
		setSaving(true);
		try {
			await getTransport().request("agent.remove", { id: agent.id });
			await getTransport().request("agent.add", {
				id: agent.id,
				name: agent.name,
				command: trimmed,
				args,
			});
			toast.success(`${agent.name} will launch with the new command.`);
		} catch (err) {
			toast.error(errorText(err), `Couldn't update ${agent.name}`);
		} finally {
			setSaving(false);
		}
	};

	if (agent.origin === "bundled") {
		return (
			<Section>
				<code
					data-testid="agent-command-readonly"
					className="block overflow-x-auto rounded-[var(--radius-sm)] border border-border-default bg-container-content-bg px-12 py-8 tr-code-text-small text-text-default"
				>
					{[agent.command, ...agent.args].join(" ")}
				</code>
				<p className="flex items-center gap-4 text-text-muted tr-text-metadata">
					<Lock className="size-12 shrink-0" />
					ThinkRail launches its bundled agent from its own binary, so this command is fixed.
				</p>
			</Section>
		);
	}

	return (
		<Section>
			<div className="flex flex-col gap-4">
				<label htmlFor="agent-command" className="text-text-muted tr-text-metadata">
					Executable
				</label>
				<div className="flex items-center gap-8">
					<Input
						id="agent-command"
						data-testid="agent-command-input"
						value={command}
						spellCheck={false}
						className="min-w-0 flex-1"
						onChange={(e) => setCommand(e.target.value)}
					/>
					<Button
						size="sm"
						variant="outline"
						data-testid="agent-command-browse"
						disabled={browsing}
						onClick={() => void browse()}
						className="shrink-0"
					>
						<FolderOpen className="size-14" />
						Browse…
					</Button>
				</div>
				<p className="text-text-muted tr-text-metadata">
					A name on your PATH, or Browse for a file.
				</p>
			</div>
			<div className="flex flex-col gap-4">
				<label htmlFor="agent-args" className="text-text-muted tr-text-metadata">
					Arguments, separated by spaces
				</label>
				<Input
					id="agent-args"
					data-testid="agent-args-input"
					value={argsText}
					spellCheck={false}
					onChange={(e) => setArgsText(e.target.value)}
				/>
			</div>
			{dirty ? (
				<div className="flex items-center gap-8">
					<Button
						size="sm"
						data-testid="agent-command-save"
						disabled={trimmed.length === 0 || saving}
						onClick={() => void save()}
					>
						Save command
					</Button>
					<Button
						variant="ghost"
						size="sm"
						disabled={saving}
						onClick={() => {
							setCommand(agent.command);
							setArgsText(formatAgentArgs(agent.args));
						}}
					>
						Reset
					</Button>
				</div>
			) : null}
		</Section>
	);
}

function Section({ children }: { children: ReactNode }) {
	return (
		<section className="flex flex-col gap-8">
			<h4 className="tr-title-compact text-text-default">Command</h4>
			{children}
		</section>
	);
}
