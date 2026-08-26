import type {
	BlueprintAgentId,
	BlueprintAuthor,
	BlueprintChangedPayload,
	BlueprintDoc,
	BlueprintEdit,
	BlueprintEditTarget,
	BlueprintSource,
	BlueprintState,
} from "@thinkrail/contracts";
import { loadBlueprints, saveBlueprints } from "../persistence";
import { readBlueprintFile, writeBlueprintFile } from "./document";
import { blueprintBlockLines, parseBlueprint, serializeBlueprint } from "./format";
import { describeSource, reconcilePrompt } from "./prompts";
import { applySelection, applyTextEdit, carryOverLocks, diffBlueprints, textAt } from "./reconcile";

const EMPTY: BlueprintDoc = { blocks: [], frontmatter: "" };

interface Session {
	workspaceId: string;
	worktreePath: string;
	source: BlueprintSource;
	agentId: BlueprintAgentId;
	author: BlueprintAuthor | null;
	/**
	 * What the panel last showed, so a rewrite by the agent can be reported as a set of changes. `null`
	 * until it has shown one: the first sight of a document is not nine things moving, it is the document.
	 */
	seen: BlueprintDoc | null;
	pendingEdits: BlueprintEdit[];
}

const sessions = new Map<string, Session>();

/**
 * The brief and the author outlive the process — closing the panel, or restarting the host, must not
 * turn the spec into an orphan file nobody can talk to. See SPEC.md.
 */
function remember(session: Session): void {
	const all = loadBlueprints();
	all[session.workspaceId] = {
		source: session.source,
		agentId: session.agentId,
		...(session.author ? { author: session.author } : {}),
	};
	saveBlueprints(all);
}

/** Brings a workspace's blueprint back from disk, so a reopened panel finds its author again. */
function restore(workspaceId: string, worktreePath: string): Session | null {
	const record = loadBlueprints()[workspaceId];
	if (!record) return null;
	const session: Session = {
		workspaceId,
		worktreePath,
		source: record.source,
		agentId: record.agentId,
		author: record.author ?? null,
		seen: null,
		pendingEdits: [],
	};
	sessions.set(workspaceId, session);
	return session;
}

let publish: (payload: BlueprintChangedPayload) => void = () => {};
export function setBlueprintPublisher(fn: (payload: BlueprintChangedPayload) => void): void {
	publish = fn;
}

function get(workspaceId: string): Session {
	const session = sessions.get(workspaceId);
	if (!session) throw new Error(`No blueprint in workspace ${workspaceId}`);
	return session;
}

function onDisk(session: Session): BlueprintDoc | null {
	const text = readBlueprintFile(session.worktreePath);
	if (text === null) return null;
	return carryOverLocks(session.seen ?? EMPTY, parseBlueprint(text));
}

function stateOf(session: Session, doc: BlueprintDoc | null): BlueprintState {
	return {
		workspaceId: session.workspaceId,
		source: session.source,
		brief: describeSource(session.source),
		agentId: session.agentId,
		author: session.author,
		phase: doc === null ? "awaiting" : "ready",
		doc: doc ?? EMPTY,
		changes: doc && session.seen ? diffBlueprints(session.seen, doc) : [],
		pendingEdits: session.pendingEdits,
		lines: Object.fromEntries(blueprintBlockLines(doc ?? EMPTY)),
	};
}

function publishAndRemember(session: Session, doc: BlueprintDoc | null): BlueprintState {
	const state = stateOf(session, doc);
	session.seen = doc === null ? null : state.doc;
	publish({ state: structuredClone(state) });
	return state;
}

export function openBlueprint(
	workspaceId: string,
	worktreePath: string,
	source: BlueprintSource,
	agentId: BlueprintAgentId,
): BlueprintState {
	const session: Session = {
		workspaceId,
		worktreePath,
		source,
		agentId,
		author: null,
		seen: null,
		pendingEdits: [],
	};
	sessions.set(workspaceId, session);
	remember(session);
	return structuredClone(stateOf(session, onDisk(session)));
}

/**
 * Claude reports its own session id through its plugin's terminal sequence, and it is the only way to
 * resume that conversation later. Recorded on the blueprint because the PTY dies with its tab.
 */
export function noteBlueprintAuthorSession(
	workspaceId: string,
	tabKey: string,
	agentSessionId: string,
): void {
	const session = sessions.get(workspaceId);
	if (session?.author?.kind !== "terminal" || session.author.tabKey !== tabKey) return;
	if (session.author.agentSessionId === agentSessionId) return;
	session.author = { ...session.author, agentSessionId };
	remember(session);
	publishAndRemember(session, onDisk(session));
}

export function blueprintBrief(
	workspaceId: string,
): { source: BlueprintSource; author: BlueprintAuthor | null } | null {
	const session = sessions.get(workspaceId);
	return session ? { source: session.source, author: session.author } : null;
}

export function setBlueprintAuthor(workspaceId: string, author: BlueprintAuthor): void {
	const session = get(workspaceId);
	session.author = author;
	remember(session);
	publishAndRemember(session, onDisk(session));
}

export function getBlueprint(workspaceId: string, worktreePath?: string): BlueprintState | null {
	const session =
		sessions.get(workspaceId) ?? (worktreePath ? restore(workspaceId, worktreePath) : null);
	return session ? structuredClone(stateOf(session, onDisk(session))) : null;
}

/**
 * The file changed under us — the agent rewrote it. Re-reading is the only way the panel learns, because
 * the author is an ordinary agent using ordinary tools and reports to nobody.
 */
export function noteBlueprintFileChanged(workspaceId: string): void {
	const session = sessions.get(workspaceId);
	if (session) publishAndRemember(session, onDisk(session));
}

/**
 * The reader's change goes into the file here; the returned text is what the *author* still has to be
 * told, and the client delivers it — a terminal only accepts writes from its attached client.
 */
function writeAndReconcile(
	session: Session,
	doc: BlueprintDoc,
	controlIds: string[],
	edits: BlueprintEdit[],
): string {
	writeBlueprintFile(session.worktreePath, serializeBlueprint(doc));
	publishAndRemember(session, doc);
	return reconcilePrompt(doc, controlIds, edits);
}

export function selectBlueprintOption(
	workspaceId: string,
	controlId: string,
	optionId: string,
): string | null {
	const session = get(workspaceId);
	const current = onDisk(session);
	if (!current) return null;
	const edits = session.pendingEdits;
	session.pendingEdits = [];
	return writeAndReconcile(
		session,
		applySelection(current, controlId, optionId),
		[controlId],
		edits,
	);
}

/**
 * Text lands in the file only on confirm: prose is edited a keystroke at a time, and asking the author to
 * reconcile per keystroke would be both wasteful and unreadable. See SPEC.md.
 */
export function editBlueprintText(
	workspaceId: string,
	target: BlueprintEditTarget,
	after: string,
): void {
	const session = get(workspaceId);
	if (!session.seen) return;
	const before = textAt(session.seen, target);
	if (before === null || before === after) return;

	const key = JSON.stringify(target);
	const original = session.pendingEdits.find((edit) => JSON.stringify(edit.target) === key);
	session.pendingEdits = [
		...session.pendingEdits.filter((edit) => JSON.stringify(edit.target) !== key),
		{ target, before: original?.before ?? before, after },
	];
	publishAndRemember(session, applyTextEdit(session.seen, target, after));
}

export function confirmBlueprintEdits(workspaceId: string): string | null {
	const session = get(workspaceId);
	if (session.pendingEdits.length === 0 || !session.seen) return null;
	const edits = session.pendingEdits;
	session.pendingEdits = [];
	return writeAndReconcile(session, session.seen, [], edits);
}

/** Throws the staged text away by going back to what is actually on disk. */
export function discardBlueprintEdits(workspaceId: string): void {
	const session = get(workspaceId);
	if (session.pendingEdits.length === 0) return;
	session.pendingEdits = [];
	session.seen = null;
	publishAndRemember(session, onDisk(session));
}

/** Forgets the blueprint entirely — the file stays, but ThinkRail stops tracking who wrote it. */
export function closeBlueprint(workspaceId: string): void {
	sessions.delete(workspaceId);
	const all = loadBlueprints();
	delete all[workspaceId];
	saveBlueprints(all);
}

export function resetBlueprintsForTest(): void {
	sessions.clear();
}
