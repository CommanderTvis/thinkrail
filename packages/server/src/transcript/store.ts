import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
	ChatEvent,
	ChatMessage,
	MessageId,
	SessionRecord,
	TranscriptCorpusEntry,
	TranscriptCorpusSession,
	TranscriptCorpusSnapshot,
	TranscriptSnapshot,
} from "@thinkrail/contracts";
import { trashFile } from "../trash";
import {
	createFold,
	deriveCorpus,
	ingest,
	type PlannedEntry,
	recordOf,
	repairOnOpen,
	replay,
	type TranscriptFold,
} from "./fold";
import { encodeEntry, type LogEntry, type LogHead, TRANSCRIPT_LOG_VERSION } from "./format";
import { loadLog, TranscriptAppender } from "./log";
import { logSize, readMeta, TRANSCRIPT_META_VERSION, writeMeta } from "./meta";
import {
	sessionIdFromDirName,
	type TranscriptPaths,
	transcriptPaths,
	transcriptPathsForDir,
	transcriptsRoot,
} from "./paths";

const META_FLUSH_MS = 5000;

export interface OpenTranscriptInput {
	sessionId: string;
	workspaceId: string;
	cwd: string;
	agentId: string;
}

export interface TranscriptListFilter {
	workspaceId?: string;
}

export interface TranscriptAppendResult {
	changed: readonly ChatMessage[];
	record: SessionRecord;
}

interface OpenSession {
	readonly paths: TranscriptPaths;
	readonly fold: TranscriptFold;
	readonly appender: TranscriptAppender;
	record: SessionRecord;
	metaTimer: ReturnType<typeof setTimeout> | null;
	metaDirty: boolean;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		timer.unref();
	});
}

function isStructural(entry: LogEntry): boolean {
	return entry.t !== "part" || entry.body.k !== "chunk";
}

export class TranscriptStore {
	private readonly records = new Map<string, SessionRecord>();
	private readonly corpusCache = new Map<string, readonly TranscriptCorpusEntry[]>();
	private readonly sessions = new Map<string, OpenSession>();
	private readonly tombstones = new Set<string>();
	private readonly deleting = new Map<string, Promise<void>>();
	private recordsLoad: Promise<void> | null = null;
	private recordsLoaded = false;
	private corpusLoad: Promise<void> | null = null;
	private corpusLoaded = false;

	constructor(
		private readonly root: string = transcriptsRoot(),
		private readonly mintId: () => MessageId = () => crypto.randomUUID(),
	) {}

	isDeleted(sessionId: string): boolean {
		return this.tombstones.has(sessionId);
	}

	async open(input: OpenTranscriptInput): Promise<SessionRecord> {
		this.assertLive(input.sessionId);
		await this.ensureRecords();
		const already = this.sessions.get(input.sessionId);
		if (already !== undefined) return already.record;

		const paths = transcriptPaths(this.root, input.sessionId);
		await mkdir(paths.dir, { recursive: true });
		const loaded = await loadLog(paths, true);
		const planned: PlannedEntry[] = [];
		let fold: TranscriptFold;
		let bytes: number;
		if (loaded?.head != null) {
			if (loaded.head.workspaceId !== input.workspaceId) {
				throw new Error(`Transcript belongs to another workspace: ${input.sessionId}`);
			}
			fold = replay(loaded.head, loaded.entries);
			bytes = loaded.bytes;
			planned.push(...repairOnOpen(fold, Date.now(), this.mintId));
		} else {
			const head: LogHead = {
				t: "head",
				v: TRANSCRIPT_LOG_VERSION,
				sessionId: input.sessionId,
				workspaceId: input.workspaceId,
				cwd: input.cwd,
				agentId: input.agentId,
				createdAt: Date.now(),
			};
			fold = createFold(head);
			bytes = 0;
			planned.push({ entry: head, durable: true });
		}

		const appender = new TranscriptAppender(paths.log, bytes, (error) =>
			this.reportWriteFailure(input.sessionId, error),
		);
		for (const item of planned) {
			if (item.durable) appender.append(encodeEntry(item.entry), isStructural(item.entry));
		}

		const session: OpenSession = {
			paths,
			fold,
			appender,
			record: recordOf(fold),
			metaTimer: null,
			metaDirty: true,
		};
		this.sessions.set(input.sessionId, session);
		this.records.set(input.sessionId, session.record);
		this.corpusCache.delete(input.sessionId);
		await appender.flush();
		return session.record;
	}

	append(sessionId: string, event: ChatEvent): TranscriptAppendResult {
		const session = this.sessions.get(sessionId);
		if (session === undefined) throw new Error(`Transcript is not open: ${sessionId}`);
		const { entries, changed } = ingest(session.fold, event, Date.now());
		for (const item of entries) {
			if (item.durable) session.appender.append(encodeEntry(item.entry), isStructural(item.entry));
		}
		session.record = recordOf(session.fold);
		this.records.set(sessionId, session.record);
		if (entries.length > 0) this.scheduleMeta(session);
		const messages: ChatMessage[] = [];
		for (const id of changed) {
			const message = session.fold.byId.get(id);
			if (message !== undefined) messages.push(message);
		}
		return { changed: messages, record: session.record };
	}

	async read(sessionId: string): Promise<TranscriptSnapshot> {
		this.assertLive(sessionId);
		const open = this.sessions.get(sessionId);
		if (open !== undefined) return { record: open.record, messages: open.fold.messages };
		await this.ensureRecords();
		const known = this.records.get(sessionId);
		if (known === undefined) throw new Error(`Unknown transcript: ${sessionId}`);
		const loaded = await loadLog(transcriptPaths(this.root, sessionId), false);
		if (loaded?.head == null) return { record: known, messages: [] };
		const fold = replay(loaded.head, loaded.entries);
		const record = recordOf(fold);
		this.records.set(sessionId, record);
		this.corpusCache.set(sessionId, deriveCorpus(fold));
		return { record, messages: fold.messages };
	}

	async list(filter: TranscriptListFilter = {}): Promise<readonly SessionRecord[]> {
		await this.ensureRecords();
		const out = [...this.records.values()].filter(
			(record) =>
				!this.tombstones.has(record.sessionId) &&
				(filter.workspaceId === undefined || record.workspaceId === filter.workspaceId),
		);
		out.sort((a, b) => b.updatedAt - a.updatedAt);
		return out;
	}

	async readCorpus(budgetMs = 0): Promise<TranscriptCorpusSnapshot> {
		await this.ensureRecords();
		if (!this.corpusLoaded && this.corpusLoad === null) {
			this.corpusLoad = this.loadCorpus()
				.catch(() => undefined)
				.finally(() => {
					this.corpusLoad = null;
				});
		}
		const load = this.corpusLoad;
		if (load !== null) await (budgetMs > 0 ? Promise.race([load, delay(budgetMs)]) : load);

		const sessions: TranscriptCorpusSession[] = [];
		for (const record of this.records.values()) {
			if (this.tombstones.has(record.sessionId)) continue;
			const open = this.sessions.get(record.sessionId);
			const entries =
				open !== undefined ? deriveCorpus(open.fold) : this.corpusCache.get(record.sessionId);
			if (entries === undefined) continue;
			sessions.push({
				sessionId: record.sessionId,
				workspaceId: record.workspaceId,
				cwd: record.cwd,
				title: record.title,
				entries,
			});
		}
		return { sessions, complete: this.corpusLoaded && this.corpusLoad === null };
	}

	async close(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (session === undefined) return;
		this.sessions.delete(sessionId);
		if (session.metaTimer !== null) {
			clearTimeout(session.metaTimer);
			session.metaTimer = null;
		}
		this.corpusCache.set(sessionId, deriveCorpus(session.fold));
		session.metaDirty = true;
		await this.writeSessionMeta(session).catch(() => undefined);
	}

	async flush(sessionId: string): Promise<void> {
		await this.sessions.get(sessionId)?.appender.flush();
	}

	async flushAll(): Promise<void> {
		await Promise.all(
			[...this.sessions.values()].map(async (session) => {
				await session.appender.flush();
				await this.writeSessionMeta(session).catch(() => undefined);
			}),
		);
	}

	delete(sessionId: string): Promise<void> {
		const inFlight = this.deleting.get(sessionId);
		if (inFlight !== undefined) return inFlight;
		const done = this.runDelete(sessionId).finally(() => {
			this.deleting.delete(sessionId);
		});
		this.deleting.set(sessionId, done);
		return done;
	}

	async releaseWorkspace(workspaceId: string): Promise<void> {
		await this.ensureRecords();
		for (const record of [...this.records.values()]) {
			if (record.workspaceId !== workspaceId) continue;
			await this.close(record.sessionId);
		}
	}

	async dispose(): Promise<void> {
		await this.flushAll();
		for (const session of this.sessions.values()) {
			if (session.metaTimer !== null) clearTimeout(session.metaTimer);
		}
		this.sessions.clear();
	}

	private assertLive(sessionId: string): void {
		if (this.tombstones.has(sessionId)) throw new Error(`Unknown transcript: ${sessionId}`);
	}

	private reportWriteFailure(sessionId: string, error: unknown): void {
		const detail = error instanceof Error ? error.message : String(error);
		console.warn(`transcript ${sessionId}: ${detail}`);
	}

	private ensureRecords(): Promise<void> {
		if (this.recordsLoaded) return Promise.resolve();
		if (this.recordsLoad === null) {
			this.recordsLoad = this.loadRecords()
				.catch(() => undefined)
				.finally(() => {
					this.recordsLoad = null;
				});
		}
		return this.recordsLoad;
	}

	private async loadRecords(): Promise<void> {
		let names: string[];
		try {
			names = (await readdir(this.root, { withFileTypes: true }))
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name);
		} catch {
			this.recordsLoaded = true;
			return;
		}
		for (const name of names) {
			const sessionId = sessionIdFromDirName(name);
			if (sessionId === null || this.records.has(sessionId)) continue;
			try {
				await this.adopt(sessionId, transcriptPathsForDir(join(this.root, name)));
			} catch {
				this.records.set(sessionId, placeholderRecord(sessionId));
			}
		}
		this.recordsLoaded = true;
	}

	private async adopt(sessionId: string, paths: TranscriptPaths): Promise<void> {
		const meta = await readMeta(paths);
		if (meta !== null && meta.logBytes === (await logSize(paths))) {
			this.records.set(sessionId, meta.record);
			return;
		}
		const loaded = await loadLog(paths, false);
		if (loaded?.head == null) {
			this.records.set(sessionId, placeholderRecord(sessionId));
			return;
		}
		const fold = replay(loaded.head, loaded.entries);
		const record = recordOf(fold);
		this.records.set(sessionId, record);
		this.corpusCache.set(sessionId, deriveCorpus(fold));
		await writeMeta(paths, {
			v: TRANSCRIPT_META_VERSION,
			record,
			logBytes: loaded.bytes,
		}).catch(() => undefined);
	}

	private async loadCorpus(): Promise<void> {
		for (const sessionId of [...this.records.keys()]) {
			if (this.corpusCache.has(sessionId) || this.sessions.has(sessionId)) continue;
			try {
				const loaded = await loadLog(transcriptPaths(this.root, sessionId), false);
				this.corpusCache.set(
					sessionId,
					loaded?.head != null ? deriveCorpus(replay(loaded.head, loaded.entries)) : [],
				);
			} catch {
				this.corpusCache.set(sessionId, []);
			}
		}
		this.corpusLoaded = true;
	}

	private scheduleMeta(session: OpenSession): void {
		session.metaDirty = true;
		if (session.metaTimer !== null) return;
		const timer = setTimeout(() => {
			session.metaTimer = null;
			void this.writeSessionMeta(session).catch(() => undefined);
		}, META_FLUSH_MS);
		timer.unref();
		session.metaTimer = timer;
	}

	private async writeSessionMeta(session: OpenSession): Promise<void> {
		if (!session.metaDirty) return;
		session.metaDirty = false;
		await session.appender.flush();
		await writeMeta(session.paths, {
			v: TRANSCRIPT_META_VERSION,
			record: session.record,
			logBytes: session.appender.bytes,
		});
	}

	private async runDelete(sessionId: string): Promise<void> {
		const installed = !this.tombstones.has(sessionId);
		this.tombstones.add(sessionId);
		const paths = transcriptPaths(this.root, sessionId);
		try {
			const session = this.sessions.get(sessionId);
			if (session !== undefined) {
				this.sessions.delete(sessionId);
				if (session.metaTimer !== null) clearTimeout(session.metaTimer);
				await session.appender.flush();
			}
			await trashFile(paths.dir);
		} catch (error) {
			if (installed) this.tombstones.delete(sessionId);
			throw error;
		}
		this.records.delete(sessionId);
		this.corpusCache.delete(sessionId);
	}
}

function placeholderRecord(sessionId: string): SessionRecord {
	return {
		sessionId,
		workspaceId: "",
		cwd: "",
		agentId: "",
		title: null,
		createdAt: 0,
		updatedAt: 0,
		messageCount: 0,
		promptCount: 0,
		lastSettlement: null,
		usage: null,
		config: [],
	};
}

let instance: TranscriptStore | null = null;

export function getTranscriptStore(): TranscriptStore {
	instance ??= new TranscriptStore();
	return instance;
}
