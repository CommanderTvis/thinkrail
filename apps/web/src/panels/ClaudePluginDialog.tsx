import type { ClaudeEdit } from "@thinkrail/contracts";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { ComposeActions, FIELD_CLASS, Field } from "./ClaudeConfigParts";
import { ToggleSegment } from "./ToggleSegment";

/** Describe the plugin and where it comes from, before anything is asked about where the entry goes. */
export function ClaudePluginDialog({
	open,
	onClose,
	onCompose,
}: {
	open: boolean;
	onClose: () => void;
	onCompose: (pending: { edit: ClaudeEdit; title: string }) => void;
}) {
	const [kind, setKind] = useState<"github" | "directory">("github");
	const [repo, setRepo] = useState("");
	const [path, setPath] = useState("");
	const [marketplace, setMarketplace] = useState("");
	const [plugin, setPlugin] = useState("");

	const problem =
		marketplace.trim() === ""
			? "A marketplace name is needed — it is what the plugin's id is scoped by."
			: plugin.trim() === ""
				? "A plugin name is needed."
				: kind === "github" && !/^[^/\s]+\/[^/\s]+$/.test(repo.trim())
					? "A GitHub marketplace is owner/repo."
					: kind === "directory" && path.trim() === ""
						? "A path is needed."
						: null;

	return (
		<Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
			<DialogContent className="flex w-full max-w-[34rem] flex-col gap-12">
				<DialogHeader>
					<DialogTitle>Add a plugin</DialogTitle>
				</DialogHeader>

				<Field label="Where it comes from">
					<div className="flex items-center gap-8">
						<ToggleSegment
							testid="claude-plugin-source-github"
							label="GitHub"
							active={kind === "github"}
							onClick={() => setKind("github")}
						/>
						<ToggleSegment
							testid="claude-plugin-source-directory"
							label="Directory"
							active={kind === "directory"}
							onClick={() => setKind("directory")}
						/>
					</div>
				</Field>

				{kind === "github" ? (
					<Field label="Repository">
						<input
							value={repo}
							onChange={(change) => setRepo(change.target.value)}
							spellCheck={false}
							autoFocus
							aria-label="Marketplace repository"
							data-testid="claude-plugin-repo"
							placeholder="anthropics/claude-code"
							className={FIELD_CLASS}
						/>
					</Field>
				) : (
					<Field label="Path" hint="An absolute path to the marketplace directory.">
						<input
							value={path}
							onChange={(change) => setPath(change.target.value)}
							spellCheck={false}
							autoFocus
							aria-label="Marketplace path"
							data-testid="claude-plugin-path"
							className={FIELD_CLASS}
						/>
					</Field>
				)}

				<Field
					label="Marketplace name"
					hint="How the entry is keyed, and what scopes the plugin id."
				>
					<input
						value={marketplace}
						onChange={(change) => setMarketplace(change.target.value)}
						spellCheck={false}
						aria-label="Marketplace name"
						data-testid="claude-plugin-marketplace"
						placeholder="claude-code-plugins"
						className={FIELD_CLASS}
					/>
				</Field>

				<Field label="Plugin">
					<input
						value={plugin}
						onChange={(change) => setPlugin(change.target.value)}
						spellCheck={false}
						aria-label="Plugin name"
						data-testid="claude-plugin-name"
						placeholder="typescript-lsp"
						className={FIELD_CLASS}
					/>
				</Field>

				<p className="tr-text-metadata text-text-muted">
					A plugin brings its own hooks, skills and MCP servers, which run with your permissions.
					Claude Code fetches it on next start; this only records that you want it.
				</p>

				<ComposeActions
					testid="claude-plugin"
					problem={problem}
					onCancel={onClose}
					onSubmit={() =>
						onCompose({
							edit: {
								kind: "plugin-add",
								marketplace: marketplace.trim(),
								plugin: plugin.trim(),
								source:
									kind === "github"
										? { kind: "github", repo: repo.trim() }
										: { kind: "directory", path: path.trim() },
							},
							title: `Add "${plugin.trim()}" from "${marketplace.trim()}"`,
						})
					}
				/>
			</DialogContent>
		</Dialog>
	);
}
