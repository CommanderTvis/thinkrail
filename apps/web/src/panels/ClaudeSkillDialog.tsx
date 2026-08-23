import type { ClaudeEdit } from "@thinkrail/contracts";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { ComposeActions, FIELD_CLASS, Field } from "./ClaudeConfigParts";

/** Describe the skill, before anything is asked about where it goes — see panels/SPEC.md. */
export function ClaudeSkillDialog({
	open,
	onClose,
	onCompose,
}: {
	open: boolean;
	onClose: () => void;
	onCompose: (pending: { edit: ClaudeEdit; title: string }) => void;
}) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	const problem =
		name.trim() === ""
			? "A name is needed."
			: description.trim() === ""
				? "A description is needed — it is the whole of what Claude reads when deciding to use a skill."
				: null;

	return (
		<Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
			<DialogContent className="flex w-full max-w-[34rem] flex-col gap-12">
				<DialogHeader>
					<DialogTitle>Create a skill</DialogTitle>
				</DialogHeader>

				<Field label="Name" hint="Becomes the directory name, lowercased and hyphenated.">
					<input
						value={name}
						onChange={(event) => setName(event.target.value)}
						spellCheck={false}
						autoFocus
						aria-label="Skill name"
						data-testid="claude-skill-name"
						placeholder="reviewing-a-migration"
						className={FIELD_CLASS}
					/>
				</Field>

				<Field label="Description" hint="When Claude should reach for it, in one sentence.">
					<textarea
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						rows={3}
						aria-label="Skill description"
						data-testid="claude-skill-description"
						placeholder="Use when a change moves data between schema versions."
						className={`resize-y ${FIELD_CLASS}`}
					/>
				</Field>

				<p className="tr-text-metadata text-text-muted">
					This writes the skill's <span className="tr-code-text">SKILL.md</span> with its
					frontmatter and a heading. What it should actually do, you write in the file.
				</p>

				<ComposeActions
					testid="claude-skill"
					problem={problem}
					onCancel={onClose}
					onSubmit={() =>
						onCompose({
							edit: { kind: "skill-create", name: name.trim(), description: description.trim() },
							title: `Create the skill "${name.trim()}"`,
						})
					}
				/>
			</DialogContent>
		</Dialog>
	);
}
