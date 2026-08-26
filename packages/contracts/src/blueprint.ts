/** The one file a blueprint lives in, at the root of its worktree. */
export const BLUEPRINT_FILE = "BLUEPRINT.md";

export interface BlueprintOption {
	id: string;
	label: string;
	axis: string;
}

/** Open vocabulary: a kind the host does not know renders as `select`, never as nothing. */
export type BlueprintControlKind = "select" | "multi";

export interface BlueprintControl {
	id: string;
	kind: BlueprintControlKind;
	title: string;
	options: BlueprintOption[];
	/** `select` holds at most one; `multi` holds any number, in option order. */
	selectedIds: string[];
	/** The agent opened the block but has not emitted its options yet — true only mid-stream. */
	pending: boolean;
	/** The user set this by hand; regeneration may not re-decide it. */
	locked: boolean;
}

/** `id` is the render key: a control keeps its own id, prose is numbered in document order. */
export type BlueprintBlock =
	| { kind: "prose"; id: string; text: string }
	| { kind: "control"; id: string; control: BlueprintControl };

/** A block's 1-based, frontmatter-inclusive span in the serialized file. */
export interface BlueprintBlockLines {
	startLine: number;
	endLine: number;
}

export interface BlueprintDoc {
	blocks: BlueprintBlock[];
	/** The spec-graph frontmatter, round-tripped verbatim; shown as properties, never as prose. */
	frontmatter: string;
}

export type BlueprintAgentId = "pi" | "claude";

/**
 * What the author is given to start from. `product` and `spec` are *takeovers* — the decisions already
 * exist, in code or in prose, and the author's job is to surface them as controls someone can change.
 */
export type BlueprintSource =
	| { kind: "idea"; brief: string }
	/** The worktree itself: read the code and write down the decisions it already made. */
	| { kind: "product" }
	/** A markdown document already in the worktree, worktree-relative. Read, never written. */
	| { kind: "spec"; path: string };

export interface BlueprintAgentInfo {
	id: BlueprintAgentId;
	label: string;
	available: boolean;
	/** Why it cannot run, when `available` is false. */
	reason: string | null;
}

/** `awaiting` = the author has not written the file yet; `ready` = it is on disk and rendered. */
export type BlueprintPhase = "awaiting" | "ready";

/** Where a text edit landed, so the reactor can be told what the reader meant by it. */
export type BlueprintEditTarget =
	| { kind: "frontmatter" }
	| { kind: "prose"; blockId: string }
	| { kind: "option-label"; controlId: string; optionId: string }
	| { kind: "option-axis"; controlId: string; optionId: string };

export interface BlueprintEdit {
	target: BlueprintEditTarget;
	before: string;
	after: string;
}

export type BlueprintChange =
	| { kind: "control-added"; controlId: string; title: string }
	| { kind: "control-removed"; controlId: string; title: string }
	| { kind: "control-reselected"; controlId: string; title: string; from: string; to: string }
	| { kind: "control-options-changed"; controlId: string; title: string }
	| { kind: "prose-changed"; count: number };

/** Who writes the file — and therefore who ThinkRail talks to when the reader changes it. */
export type BlueprintAuthor =
	| { kind: "chat"; sessionId: string }
	/** `agentSessionId` is Claude's own, reported by its plugin — what `--resume` needs. */
	| { kind: "terminal"; tabKey: string; agentSessionId?: string };

export interface BlueprintState {
	/** One blueprint per workspace: the workspace id *is* the blueprint's identity. */
	workspaceId: string;
	source: BlueprintSource;
	/** One line naming what this spec came from — the brief, the project, or the document. */
	brief: string;
	agentId: BlueprintAgentId;
	author: BlueprintAuthor | null;
	phase: BlueprintPhase;
	doc: BlueprintDoc;
	/** What moved since the panel last showed this document — the agent's last rewrite, highlighted. */
	changes: BlueprintChange[];
	/** Text the reader rewrote but has not confirmed: shown in `doc`, not yet in the file. */
	pendingEdits: BlueprintEdit[];
	/** Each block's span in the file, by block id — what lets a selection here name file lines. */
	lines: Record<string, BlueprintBlockLines>;
}

export interface BlueprintChangedPayload {
	state: BlueprintState;
}

/**
 * A change the reader made from the panel is already in the file; `reconcile` is what the *author* still
 * has to be told, delivered by the client because a terminal only accepts writes from its attached one.
 */
export interface BlueprintMutationResult {
	reconcile: string | null;
}

/** What the client needs to start the author: the opening message, or the command line to run it. */
export interface BlueprintLaunch {
	state: BlueprintState;
	opening: string;
	command: string | null;
}
