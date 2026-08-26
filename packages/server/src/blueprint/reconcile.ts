import type {
	BlueprintChange,
	BlueprintControl,
	BlueprintDoc,
	BlueprintEdit,
	BlueprintEditTarget,
} from "@thinkrail/contracts";
import { controlsOf, selectedLabels, slug } from "./format";

function mapControls(doc: BlueprintDoc): Map<string, BlueprintControl> {
	return new Map(controlsOf(doc).map((control) => [control.id, control]));
}

function mapControl(
	doc: BlueprintDoc,
	controlId: string,
	change: (control: BlueprintControl) => BlueprintControl,
): BlueprintDoc {
	return {
		frontmatter: doc.frontmatter,
		blocks: doc.blocks.map((block) =>
			block.kind === "control" && block.control.id === controlId
				? { kind: "control", id: block.id, control: change(block.control) }
				: block,
		),
	};
}

/**
 * `select` replaces its one selection; `multi` toggles and keeps document order, so the serialized
 * checkbox list never reshuffles under the reader.
 */
export function applySelection(
	doc: BlueprintDoc,
	controlId: string,
	optionId: string,
): BlueprintDoc {
	return mapControl(doc, controlId, (control) => {
		if (!control.options.some((option) => option.id === optionId)) return control;
		const selectedIds =
			control.kind === "select"
				? [optionId]
				: control.options
						.filter((option) =>
							option.id === optionId
								? !control.selectedIds.includes(optionId)
								: control.selectedIds.includes(option.id),
						)
						.map((option) => option.id);
		return { ...control, selectedIds, locked: true };
	});
}

/**
 * An option's id is the slug of its label, so renaming one moves its identity — selection has to move
 * with it in the same step or the reader's choice silently detaches from what they just renamed.
 */
export function applyTextEdit(
	doc: BlueprintDoc,
	target: BlueprintEditTarget,
	after: string,
): BlueprintDoc {
	if (target.kind === "frontmatter") return { frontmatter: after, blocks: doc.blocks };
	if (target.kind === "prose") {
		return {
			frontmatter: doc.frontmatter,
			blocks: doc.blocks.map((block) =>
				block.kind === "prose" && block.id === target.blockId
					? { kind: "prose", id: block.id, text: after }
					: block,
			),
		};
	}
	return mapControl(doc, target.controlId, (control) => {
		const taken = new Set(control.options.map((option) => option.id));
		const options = control.options.map((option) => {
			if (option.id !== target.optionId) return option;
			if (target.kind === "option-axis") return { ...option, axis: after };
			taken.delete(option.id);
			let id = slug(after);
			for (let n = 2; taken.has(id); n++) id = `${slug(after)}-${n}`;
			return { ...option, id, label: after };
		});
		const renamed = options.find((option, at) => option.id !== control.options[at]?.id);
		const selectedIds =
			renamed && control.selectedIds.includes(target.optionId)
				? control.selectedIds.map((id) => (id === target.optionId ? renamed.id : id))
				: control.selectedIds;
		return { ...control, options, selectedIds };
	});
}

export function textAt(doc: BlueprintDoc, target: BlueprintEditTarget): string | null {
	if (target.kind === "frontmatter") return doc.frontmatter;
	if (target.kind === "prose") {
		const block = doc.blocks.find((entry) => entry.kind === "prose" && entry.id === target.blockId);
		return block?.kind === "prose" ? block.text : null;
	}
	const option = mapControls(doc)
		.get(target.controlId)
		?.options.find((entry) => entry.id === target.optionId);
	if (!option) return null;
	return target.kind === "option-axis" ? option.axis : option.label;
}

/**
 * The prompt asks the agent to leave locked controls alone; this makes it true. A locked selection the
 * agent dropped from the option list is put back rather than silently re-decided — see SPEC.md.
 */
export function carryOverLocks(previous: BlueprintDoc, next: BlueprintDoc): BlueprintDoc {
	const before = mapControls(previous);
	return {
		frontmatter: next.frontmatter,
		blocks: next.blocks.map((block) => {
			if (block.kind !== "control") return block;
			const prior = before.get(block.control.id);
			if (!prior?.locked || prior.selectedIds.length === 0) return block;
			const kept = prior.options.filter((option) => prior.selectedIds.includes(option.id));
			if (kept.length === 0) return block;
			const missing = kept.filter(
				(option) => !block.control.options.some((candidate) => candidate.id === option.id),
			);
			return {
				kind: "control",
				id: block.id,
				control: {
					...block.control,
					kind: prior.kind,
					options: [...missing, ...block.control.options],
					selectedIds: kept.map((option) => option.id),
					locked: true,
				},
			};
		}),
	};
}

export function diffBlueprints(base: BlueprintDoc, next: BlueprintDoc): BlueprintChange[] {
	const before = mapControls(base);
	const after = mapControls(next);
	const changes: BlueprintChange[] = [];
	const optionsOf = (entry: BlueprintControl) =>
		entry.options.map((option) => `${option.id} ${option.axis}`).join("");

	for (const [id, control] of after) {
		const prior = before.get(id);
		if (!prior) {
			changes.push({ kind: "control-added", controlId: id, title: control.title });
			continue;
		}
		if (prior.selectedIds.join() !== control.selectedIds.join()) {
			changes.push({
				kind: "control-reselected",
				controlId: id,
				title: control.title,
				from: selectedLabels(prior),
				to: selectedLabels(control),
			});
			continue;
		}
		if (optionsOf(prior) !== optionsOf(control)) {
			changes.push({ kind: "control-options-changed", controlId: id, title: control.title });
		}
	}

	for (const [id, control] of before) {
		if (!after.has(id)) {
			changes.push({ kind: "control-removed", controlId: id, title: control.title });
		}
	}

	const proseOf = (doc: BlueprintDoc) =>
		doc.blocks.flatMap((block) => (block.kind === "prose" ? [slug(block.text)] : []));
	const priorProse = new Set(proseOf(base));
	const rewritten = proseOf(next).filter((text) => !priorProse.has(text)).length;
	if (rewritten > 0) changes.push({ kind: "prose-changed", count: rewritten });

	return changes;
}

export function describeEdit(doc: BlueprintDoc, edit: BlueprintEdit): string {
	const { target } = edit;
	if (target.kind === "prose") return `a passage now reads: ${edit.after}`;
	if (target.kind === "frontmatter") return `the frontmatter now reads:\n${edit.after}`;
	const control = mapControls(doc).get(target.controlId);
	const what = target.kind === "option-axis" ? "the reason for" : "the name of";
	return `${what} an option under ${control?.title ?? target.controlId} is now "${edit.after}" (was "${edit.before}")`;
}
