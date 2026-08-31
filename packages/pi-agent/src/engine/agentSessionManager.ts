import { createReadStream, existsSync, rmSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type ContextUsage,
	createAgentSession,
	type ExtensionError,
	getAgentDir,
	type SessionInfo,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AskUserQuestionResult, SlashCommand } from "@thinkrail/contracts";
import type { ParentContext } from "pi-delegation";
import { ANSWERABILITY_ERRORS, assessAnswerability, buildAnswersMessage } from "./askUserQuestion";
import {
	disposeSessionChildren,
	removeWorkspaceDelegation,
	subagentsExtensionFor,
} from "./delegation";
import { buildResourceLoader, toSkillCommands } from "./extensions";
import {
	getPiRuntime,
	getPiRuntimeGeneration,
	type PiRuntimeGeneration,
	refreshCatalogs,
	settledAvailableModels,
} from "./piRuntime";
import { type EngineEvent, projectSessionEvent } from "./sessionEventProjection";
import { repairDanglingToolCalls } from "./sessionRepair";
import type { SkillAdmissionContext } from "./skillAdmission";
import type {
	EngineModel,
	EngineSessionSummary,
	EngineSettlement,
	ModelRef,
	RefreshedModels,
} from "./types";
import { cancelExtUiForSession, createWebUiContext, notifyExtensionError } from "./webUiContext";

interface Entry {
	session: AgentSession;
	generation: PiRuntimeGeneration;
	unsubscribe: () => void;
	cwd: string;
	lastSettlement: EngineSettlement | null | undefined;
	registered: boolean;
}

const sessions = new Map<string, Entry>();

export async function usePiRuntime<T>(
	operation: (
		runtime: PiRuntimeGeneration["runtime"],
		generation: PiRuntimeGeneration,
	) => Promise<T> | T,
): Promise<T> {
	const generation = await getPiRuntimeGeneration();
	return operation(generation.runtime, generation);
}

const deletedSessions = new Map<string, string>();

const deletingSessions = new Map<string, { cwd: string; done: Promise<void> }>();

function isSessionDeleted(sessionId: string, cwd: string): boolean {
	return deletedSessions.get(sessionId) === resolve(cwd);
}

export type SessionEventSink = (sessionId: string, event: EngineEvent) => void;

let publish: SessionEventSink = () => {};
export function setSessionEventSink(sink: SessionEventSink): void {
	publish = sink;
}

let publishDeleted: (sessionId: string) => void = () => {};
export function setSessionDeletedSink(sink: (sessionId: string) => void): void {
	publishDeleted = sink;
}

export type SessionFileRemover = (path: string) => Promise<void>;

const deleteSessionFile: SessionFileRemover = (path) => rm(path, { force: true });
let sessionFileRemover: SessionFileRemover = deleteSessionFile;
export function setSessionFileRemover(remover?: SessionFileRemover): void {
	sessionFileRemover = remover ?? deleteSessionFile;
}

let sessionManagerFactory: (cwd: string) => SessionManager = (cwd) => SessionManager.create(cwd);
export function setSessionManagerFactory(factory: (cwd: string) => SessionManager): void {
	sessionManagerFactory = factory;
}

let skillAdmissionResolver: (cwd: string) => SkillAdmissionContext = () => ({
	trusted: false,
	acknowledged: [],
	disabled: [],
	disabledGroups: [],
	overrides: {},
});
export function setSkillAdmissionResolver(resolver: (cwd: string) => SkillAdmissionContext): void {
	skillAdmissionResolver = resolver;
}

function hasDeletionTombstone(sessionId: string): boolean {
	return deletedSessions.has(sessionId);
}

function mustGetEntry(sessionId: string): Entry {
	if (hasDeletionTombstone(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
	const entry = sessions.get(sessionId);
	if (!entry) throw new Error(`Unknown session: ${sessionId}`);
	return entry;
}

function mustGet(sessionId: string): AgentSession {
	return mustGetEntry(sessionId).session;
}

export function hasSession(sessionId: string): boolean {
	return sessions.has(sessionId) && !hasDeletionTombstone(sessionId);
}

export function getSessionCwd(sessionId: string): string | undefined {
	return sessions.get(sessionId)?.cwd;
}

export async function reloadSessionResources(sessionId: string): Promise<void> {
	const session = mustGet(sessionId);
	if (session.isStreaming) {
		throw new Error(
			"Can't reload skills while the session is streaming — try again after the turn.",
		);
	}
	await session.reload();
}

export function buildSessionSettings(cwd: string): SettingsManager {
	const settings = SettingsManager.create(cwd, undefined, { projectTrusted: true });
	settings.applyOverrides({ images: { autoResize: false } });
	return settings;
}

export interface SessionToolBinding {
	sessionId: string | null;
}

export type SessionToolsProvider = (
	binding: SessionToolBinding,
	cwd: string,
	settings: SettingsManager,
) => readonly ToolDefinition[];

let sessionToolsProvider: SessionToolsProvider | undefined;

export function setSessionToolsProvider(provider?: SessionToolsProvider): void {
	sessionToolsProvider = provider;
}

function providedTools(
	binding: SessionToolBinding,
	cwd: string,
	settings: SettingsManager,
): { noTools: "builtin"; customTools: ToolDefinition[] } | Record<string, never> {
	const tools = sessionToolsProvider?.(binding, cwd, settings) ?? [];
	return tools.length > 0 ? { noTools: "builtin", customTools: [...tools] } : {};
}

export interface CreateSessionInput {
	cwd: string;
	model?: ModelRef;
	thinkingLevel?: ThinkingLevel;
}

export interface CreateSessionResult {
	sessionId: string;
	model: EngineModel | null;
	thinkingLevel: ThinkingLevel;
}

export function toEngineModel(model: Model<string>): EngineModel {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		contextWindow: model.contextWindow,
		reasoning: model.reasoning,
		thinkingLevels: getSupportedThinkingLevels(model),
	};
}

function resolveModel(runtime: PiRuntimeGeneration["runtime"], ref: ModelRef): Model<string> {
	const available = settledAvailableModels(runtime);
	const match = available.find((model) => model.provider === ref.provider && model.id === ref.id);
	if (!match) throw new Error(`Unknown or unavailable model: ${ref.provider}/${ref.id}`);
	return match as unknown as Model<string>;
}

interface PreparedSessionEntry {
	entry: Entry;
	result: CreateSessionResult;
}

async function prepareSessionEntry(
	session: AgentSession,
	cwd: string,
	generation: PiRuntimeGeneration,
	lastSettlement: EngineSettlement | null | undefined = undefined,
): Promise<PreparedSessionEntry> {
	const { sessionId } = session;
	let terminal: EngineSettlement | null = null;
	const entry: Entry = {
		session,
		generation,
		unsubscribe: () => {},
		cwd: resolve(cwd),
		lastSettlement,
		registered: false,
	};
	entry.unsubscribe = session.subscribe((event) => {
		if (event.type === "agent_start") {
			entry.lastSettlement = null;
		}
		if (event.type === "agent_end") {
			const assistant = [...event.messages]
				.reverse()
				.find((message) => message.role === "assistant");
			terminal = assistant
				? {
						stopReason: assistant.stopReason,
						...(assistant.errorMessage !== undefined
							? { errorMessage: assistant.errorMessage }
							: {}),
					}
				: null;
		}
		const projected = projectSessionEvent(event, terminal);
		if (event.type === "agent_settled") entry.lastSettlement = terminal;
		if (sessions.get(sessionId) === entry) publish(sessionId, projected);
		if (event.type === "agent_settled") terminal = null;
	});

	const reportExtensionError = (failure: ExtensionError): void => {
		if (!entry.registered || sessions.get(sessionId) === entry)
			notifyExtensionError(sessionId, failure);
	};

	try {
		await session.bindExtensions({
			mode: "rpc",
			uiContext: createWebUiContext(sessionId),
			onError: reportExtensionError,
		});
		if (isSessionDeleted(sessionId, cwd)) throw new Error(`Unknown session: ${sessionId}`);
	} catch (error) {
		cancelExtUiForSession(sessionId);
		entry.unsubscribe();
		session.dispose();
		throw error;
	}

	return {
		entry,
		result: {
			sessionId,
			model: session.model ? toEngineModel(session.model as unknown as Model<string>) : null,
			thinkingLevel: session.thinkingLevel,
		},
	};
}

async function registerSession(
	session: AgentSession,
	cwd: string,
	generation: PiRuntimeGeneration,
	_announceCreation = false,
): Promise<CreateSessionResult> {
	const prepared = await prepareSessionEntry(session, cwd, generation);
	prepared.entry.registered = true;
	sessions.set(session.sessionId, prepared.entry);
	return prepared.result;
}

export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
	const generation = await getPiRuntimeGeneration();
	const settingsManager = buildSessionSettings(input.cwd);
	const binding: SessionToolBinding = { sessionId: null };
	const { session } = await createAgentSession({
		cwd: input.cwd,
		modelRuntime: generation.runtime,
		sessionManager: sessionManagerFactory(input.cwd),
		settingsManager,
		resourceLoader: await buildResourceLoader(
			input.cwd,
			settingsManager,
			() => skillAdmissionResolver(input.cwd),
			generation.excludedSessionExtensionPaths,
			[subagentsExtensionFor(input.cwd)],
		),
		...providedTools(binding, input.cwd, settingsManager),
		...(input.model ? { model: resolveModel(generation.runtime, input.model) } : {}),
		...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
	});
	binding.sessionId = session.sessionId;
	return registerSession(session, input.cwd, generation);
}

function summaryOf(sessionId: string, entry: Entry): EngineSessionSummary {
	const { session } = entry;
	return {
		sessionId,
		cwd: entry.cwd,
		title: session.sessionName ?? null,
		model: session.model ? toEngineModel(session.model as unknown as Model<string>) : null,
		thinkingLevel: session.thinkingLevel,
		isStreaming: session.isStreaming,
		messageCount: session.messages.length,
		updatedAt: Date.now(),
		live: true,
		...(entry.lastSettlement !== undefined ? { lastSettlement: entry.lastSettlement } : {}),
	};
}

interface SessionFileIdentity {
	id: string;
	cwd: string;
}

type ScannedSessionFile =
	| { path: string; ok: true; identity: SessionFileIdentity }
	| { path: string; ok: false; error: Error };

function defaultSessionDirectory(cwd: string): string {
	const resolvedCwd = resolve(cwd);
	const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(resolve(getAgentDir()), "sessions", safePath);
}

function hasErrorCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && Reflect.get(error, "code") === code;
}

async function readSessionFileIdentity(path: string): Promise<SessionFileIdentity> {
	const input = createReadStream(path, { encoding: "utf8" });
	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			if (!line.trim()) continue;
			let entry: unknown;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			if (typeof entry !== "object" || entry === null) {
				throw new Error("first parsed entry is not an object");
			}
			const id = Reflect.get(entry, "id");
			if (Reflect.get(entry, "type") !== "session" || typeof id !== "string") {
				throw new Error("first parsed entry is not a session header");
			}
			const headerCwd = Reflect.get(entry, "cwd");
			return { id, cwd: typeof headerCwd === "string" ? headerCwd : "" };
		}
		throw new Error("session header is missing");
	} catch (error) {
		throw new Error(`Session transcript is unreadable or malformed: ${path}`, { cause: error });
	} finally {
		lines.close();
		input.destroy();
	}
}

async function scanSessionFiles(
	cwd: string,
	excludedPaths: ReadonlySet<string> = new Set(),
): Promise<ScannedSessionFile[]> {
	const dir = defaultSessionDirectory(cwd);
	let names: string[];
	try {
		names = await readdir(dir);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return [];
		throw new Error(`Session directory is unreadable: ${dir}`, { cause: error });
	}
	const scanned: ScannedSessionFile[] = [];
	for (const name of names) {
		if (!name.endsWith(".jsonl")) continue;
		const path = join(dir, name);
		if (excludedPaths.has(resolve(path))) continue;
		try {
			scanned.push({ path, ok: true, identity: await readSessionFileIdentity(path) });
		} catch (error) {
			scanned.push({
				path,
				ok: false,
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}
	return scanned;
}

async function listSessionInfosStrict(
	cwd: string,
	excludedPaths: ReadonlySet<string> = new Set(),
): Promise<SessionInfo[]> {
	const scanned = await scanSessionFiles(cwd, excludedPaths);
	const broken = scanned.find((file) => !file.ok);
	if (broken && !broken.ok) throw broken.error;
	const infos = await SessionManager.list(cwd);
	const listedByPath = new Map(infos.map((info) => [resolve(info.path), info]));
	const omitted = scanned.find((file) => {
		if (!file.ok) return false;
		const listed = listedByPath.get(resolve(file.path));
		return !listed || listed.id !== file.identity.id || listed.cwd !== file.identity.cwd;
	});
	if (omitted) throw new Error(`Session transcript could not be listed: ${omitted.path}`);
	return infos;
}

async function listSessionsInternal(cwd: string): Promise<EngineSessionSummary[]> {
	const live: EngineSessionSummary[] = [];
	const liveIds = new Set<string>();
	const liveFiles = new Set<string>();
	for (const [sessionId, entry] of sessions) {
		if (entry.cwd !== resolve(cwd) || isSessionDeleted(sessionId, cwd)) continue;
		live.push(summaryOf(sessionId, entry));
		liveIds.add(sessionId);
		const sessionFile = entry.session.sessionManager.getSessionFile();
		if (sessionFile) liveFiles.add(resolve(sessionFile));
	}
	const infos = await listSessionInfosStrict(cwd, liveFiles);
	const disk: EngineSessionSummary[] = infos
		.filter((info) => info.cwd === cwd && !liveIds.has(info.id) && !isSessionDeleted(info.id, cwd))
		.map((info) => ({
			sessionId: info.id,
			cwd: resolve(cwd),
			title: info.name ?? null,
			model: null,
			thinkingLevel: "medium" as ThinkingLevel,
			isStreaming: false,
			messageCount: info.messageCount,
			updatedAt: info.modified.getTime(),
			live: false,
		}));
	return [...live, ...disk];
}

export function listSessions(cwd: string): Promise<EngineSessionSummary[]> {
	return listSessionsInternal(cwd);
}

const attaching = new Map<string, Promise<void>>();

function attachDiskSession(sessionId: string, cwd: string): Promise<void> {
	if (isSessionDeleted(sessionId, cwd))
		return Promise.reject(new Error(`Unknown session: ${sessionId}`));
	if (sessions.has(sessionId)) return Promise.resolve();
	let pending = attaching.get(sessionId);
	if (!pending) {
		pending = openDiskSession(sessionId, cwd).finally(() => attaching.delete(sessionId));
		attaching.set(sessionId, pending);
	}
	return pending;
}

function persistedSessionModelRef(model: unknown): { provider: string; id: string } | undefined {
	if (typeof model !== "object" || model === null) return undefined;
	const provider = Reflect.get(model, "provider");
	const id = Reflect.get(model, "modelId");
	if (provider === undefined && id === undefined) return undefined;
	if (typeof provider !== "string" || !provider || typeof id !== "string" || !id) {
		throw new Error("The chat's saved model is unavailable.");
	}
	return { provider, id };
}

async function openDiskSession(sessionId: string, cwd: string): Promise<void> {
	if (isSessionDeleted(sessionId, cwd)) throw new Error(`Unknown session: ${sessionId}`);
	const info = (await listSessionInfosStrict(cwd)).find(
		(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
	);
	if (!info) throw new Error(`Unknown session: ${sessionId}`);
	if (sessions.has(sessionId)) return;
	const generation = await getPiRuntimeGeneration();
	const settingsManager = buildSessionSettings(cwd);
	const sessionManager = SessionManager.open(info.path);
	const persistedModel = persistedSessionModelRef(sessionManager.buildSessionContext().model);
	let exactModel: Model<string> | undefined;
	if (persistedModel) {
		try {
			exactModel = resolveModel(generation.runtime, persistedModel);
		} catch {
			throw new Error("The chat's saved model is unavailable.");
		}
	}
	repairDanglingToolCalls(sessionManager);
	const { session } = await createAgentSession({
		cwd,
		modelRuntime: generation.runtime,
		sessionManager,
		settingsManager,
		resourceLoader: await buildResourceLoader(
			cwd,
			settingsManager,
			() => skillAdmissionResolver(cwd),
			generation.excludedSessionExtensionPaths,
			[subagentsExtensionFor(cwd)],
		),
		...providedTools({ sessionId }, cwd, settingsManager),
		...(exactModel ? { model: exactModel } : {}),
	});
	if (sessions.has(sessionId)) {
		session.dispose();
		return;
	}
	await registerSession(session, cwd, generation);
}

async function ensureSessionAttachedInternal(sessionId: string, cwd: string): Promise<boolean> {
	if (isSessionDeleted(sessionId, cwd)) return false;
	const live = sessions.get(sessionId);
	if (live) {
		if (live.cwd !== resolve(cwd)) throw new Error(`Unknown session: ${sessionId}`);
		return true;
	}
	const known = (await listSessionInfosStrict(cwd)).some(
		(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
	);
	if (!known) return false;
	await attachDiskSession(sessionId, cwd);
	if (!sessions.has(sessionId))
		throw new Error(`Session ${sessionId} was re-opened but did not register.`);
	return true;
}

export function ensureSessionAttached(sessionId: string, cwd: string): Promise<boolean> {
	return ensureSessionAttachedInternal(sessionId, cwd);
}

async function getSessionMessagesInternal(
	sessionId: string,
	cwd: string,
): Promise<{ summary: EngineSessionSummary; messages: AgentMessage[] }> {
	if (isSessionDeleted(sessionId, cwd)) throw new Error(`Unknown session: ${sessionId}`);
	let entry = sessions.get(sessionId);
	if (entry && entry.cwd !== resolve(cwd)) throw new Error(`Unknown session: ${sessionId}`);
	if (!entry) {
		await attachDiskSession(sessionId, cwd);
		if (isSessionDeleted(sessionId, cwd)) throw new Error(`Unknown session: ${sessionId}`);
		entry = sessions.get(sessionId);
		if (!entry) throw new Error(`Unknown session: ${sessionId}`);
	}
	return { summary: summaryOf(sessionId, entry), messages: [...entry.session.messages] };
}

export function getSessionMessages(
	sessionId: string,
	cwd: string,
): Promise<{ summary: EngineSessionSummary; messages: AgentMessage[] }> {
	return getSessionMessagesInternal(sessionId, cwd);
}

export async function answerQuestion(
	sessionId: string,
	toolCallId: string,
	result: AskUserQuestionResult,
): Promise<void> {
	const session = mustGet(sessionId);
	const verdict = assessAnswerability(session.messages, toolCallId);
	if (!verdict.ok) throw new Error(`${ANSWERABILITY_ERRORS[verdict.reason]}: ${toolCallId}`);
	await session.sendCustomMessage(buildAnswersMessage(toolCallId, verdict.args, result), {
		triggerTurn: true,
	});
}

export async function promptSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	const session = mustGet(sessionId);
	if (session.isStreaming) {
		await session.steer(text, images);
		return;
	}
	await session.prompt(text, images ? { images } : undefined);
}

export function steerSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	return mustGet(sessionId).steer(text, images);
}

export async function followUpSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	const session = mustGet(sessionId);
	if (session.isStreaming) {
		await session.followUp(text, images);
		return;
	}
	await session.prompt(text, images ? { images } : undefined);
}

export async function compactSession(sessionId: string, instructions?: string): Promise<void> {
	await mustGet(sessionId).compact(instructions);
}

export function abortSession(sessionId: string): Promise<void> {
	return mustGet(sessionId).abort();
}

export async function setSessionModel(sessionId: string, model: ModelRef): Promise<void> {
	const entry = mustGetEntry(sessionId);
	await entry.session.setModel(resolveModel(entry.generation.runtime, model));
}

export function setSessionThinkingLevel(sessionId: string, level: ThinkingLevel): void {
	mustGet(sessionId).setThinkingLevel(level);
}

export interface EngineSessionStats {
	sessionId: string;
	totalMessages: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	cost: number;
	contextUsage?: ContextUsage;
}

export function getSessionStats(sessionId: string): EngineSessionStats {
	const session = mustGet(sessionId);
	const stats = session.getSessionStats();
	const contextUsage = stats.contextUsage ?? session.getContextUsage();
	return {
		sessionId: stats.sessionId,
		totalMessages: stats.totalMessages,
		tokens: {
			input: stats.tokens.input,
			output: stats.tokens.output,
			cacheRead: stats.tokens.cacheRead,
			cacheWrite: stats.tokens.cacheWrite,
			total: stats.tokens.total,
		},
		cost: stats.cost,
		...(contextUsage ? { contextUsage } : {}),
	};
}

export interface EngineSessionConfig {
	model: EngineModel | null;
	thinkingLevel: ThinkingLevel;
}

export function getSessionConfig(sessionId: string): EngineSessionConfig {
	const session = mustGet(sessionId);
	return {
		model: session.model ? toEngineModel(session.model as unknown as Model<string>) : null,
		thinkingLevel: session.thinkingLevel,
	};
}

export function getSessionCommands(sessionId: string): SlashCommand[] {
	const session = mustGet(sessionId);
	const extension = session.extensionRunner.getRegisteredCommands().map((command) => ({
		name: command.invocationName,
		source: "extension" as const,
		sourceInfo: command.sourceInfo,
		...(command.description !== undefined ? { description: command.description } : {}),
	}));
	const prompt = session.promptTemplates.map((template) => ({
		name: template.name,
		description: template.description,
		source: "prompt" as const,
		sourceInfo: template.sourceInfo,
	}));
	const skill = toSkillCommands(session.resourceLoader.getSkills().skills);
	return [...extension, ...prompt, ...skill];
}

export async function listAvailableModels(): Promise<EngineModel[]> {
	const runtime = await getPiRuntime();
	void refreshCatalogs(runtime);
	return readAvailableModels(runtime);
}

export async function refreshAvailableModels(force = false): Promise<RefreshedModels> {
	const runtime = await getPiRuntime();
	const { completed } = await refreshCatalogs(runtime, { force });
	return { models: readAvailableModels(runtime), complete: completed };
}

function readAvailableModels(runtime: Awaited<ReturnType<typeof getPiRuntime>>): EngineModel[] {
	return settledAvailableModels(runtime).map((m) => toEngineModel(m as unknown as Model<string>));
}

export interface DefaultModelResult {
	model: EngineModel | null;
	thinkingLevel: ThinkingLevel;
}

export async function clampThinkingForModel(
	ref: ModelRef,
	level: ThinkingLevel,
): Promise<ThinkingLevel> {
	const generation = await getPiRuntimeGeneration();
	return clampThinkingLevel(resolveModel(generation.runtime, ref), level);
}

export async function getDefaultModel(): Promise<DefaultModelResult> {
	const available = settledAvailableModels(await getPiRuntime());
	const settings = SettingsManager.create(process.cwd());
	const provider = settings.getDefaultProvider();
	const modelId = settings.getDefaultModel();
	const pinned =
		provider && modelId
			? available.find((model) => model.provider === provider && model.id === modelId)
			: undefined;
	const resolved = (pinned ?? available[0] ?? null) as Model<string> | null;
	const saved = settings.getDefaultThinkingLevel() ?? "medium";
	const thinkingLevel = resolved ? clampThinkingLevel(resolved, saved) : saved;
	return { model: resolved ? toEngineModel(resolved) : null, thinkingLevel };
}

export function isSessionStreaming(sessionId: string): boolean {
	return mustGet(sessionId).isStreaming;
}

export function liveParentContext(sessionId: string): ParentContext | undefined {
	const entry = sessions.get(sessionId);
	if (!entry) return undefined;
	const { session } = entry;
	return {
		cwd: session.sessionManager.getCwd(),
		model: session.model,
		thinkingLevel: session.thinkingLevel,
		modelRuntime: session.modelRuntime,
	};
}

const pendingCascades = new Map<string, Set<Promise<void>>>();

function trackCascade(cwd: string, cascade: Promise<void>): Promise<void> {
	let pending = pendingCascades.get(cwd);
	if (!pending) {
		pending = new Set();
		pendingCascades.set(cwd, pending);
	}
	const scope = pending;
	const tracked: Promise<void> = cascade.then(() => {
		scope.delete(tracked);
		if (scope.size === 0 && pendingCascades.get(cwd) === scope) {
			pendingCascades.delete(cwd);
		}
	});
	scope.add(tracked);
	return tracked;
}

function disposeSession(sessionId: string): Promise<void> {
	const entry = sessions.get(sessionId);
	if (!entry) return Promise.resolve();
	const cascade = trackCascade(
		entry.cwd,
		disposeSessionChildren(entry.cwd, sessionId).catch(() => {}),
	);
	cancelExtUiForSession(sessionId);
	entry.unsubscribe();
	entry.session.dispose();
	sessions.delete(sessionId);
	return cascade;
}

export function removeSession(sessionId: string): Promise<void> {
	if (hasDeletionTombstone(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
	return disposeSession(sessionId);
}

export function disposeAllSessions(): void {
	for (const [sessionId, entry] of sessions) {
		void trackCascade(
			entry.cwd,
			disposeSessionChildren(entry.cwd, sessionId).catch(() => {}),
		);
		cancelExtUiForSession(sessionId);
		entry.unsubscribe();
		entry.session.dispose();
	}
	sessions.clear();
	deletedSessions.clear();
}

export async function settleSessionsForShutdown(timeoutMs = 2000): Promise<void> {
	const settling = new Set<Promise<unknown>>();
	for (const [sessionId, entry] of sessions) {
		if (entry.session.isStreaming) settling.add(entry.session.abort());
		settling.add(
			trackCascade(
				entry.cwd,
				disposeSessionChildren(entry.cwd, sessionId).catch(() => {}),
			),
		);
	}
	for (const pending of pendingCascades.values()) {
		for (const cascade of pending) settling.add(cascade);
	}
	if (settling.size === 0) return;
	await Promise.race([
		Promise.allSettled(settling),
		new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
	]);
}

async function removeCwdSessionsInternal(cwd: string, purge: boolean): Promise<void> {
	const ids = [...sessions]
		.filter(([, entry]) => entry.cwd === resolve(cwd))
		.map(([sessionId]) => sessionId);
	for (const sessionId of ids) {
		const entry = sessions.get(sessionId);
		if (!entry) continue;
		if (entry.session.isStreaming) await entry.session.abort().catch(() => {});
		await disposeSession(sessionId);
	}
	await Promise.all([...(pendingCascades.get(cwd) ?? [])]);
	removeWorkspaceDelegation(cwd);
	if (purge) await purgeDiskSessions(cwd);
}

export function removeCwdSessions(cwd: string, purge = false): Promise<void> {
	return removeCwdSessionsInternal(cwd, purge);
}

async function purgeDiskSessions(cwd: string): Promise<void> {
	let infos: Awaited<ReturnType<typeof SessionManager.list>>;
	try {
		infos = await SessionManager.list(cwd);
	} catch {
		return;
	}
	for (const info of infos) {
		if (info.cwd === cwd) rmSync(info.path, { force: true });
	}
}

export function deleteSession(sessionId: string, cwd: string): Promise<void> {
	const inFlight = deletingSessions.get(sessionId);
	if (inFlight) {
		if (inFlight.cwd !== resolve(cwd))
			return Promise.reject(new Error(`Unknown session: ${sessionId}`));
		return inFlight.done;
	}

	const transaction = runDeleteTransaction(sessionId, cwd);
	const done = transaction.then(
		() => {
			deletingSessions.delete(sessionId);
		},
		(error: unknown) => {
			deletingSessions.delete(sessionId);
			throw error;
		},
	);
	deletingSessions.set(sessionId, { cwd: resolve(cwd), done });
	return done;
}

async function runDeleteTransaction(sessionId: string, cwd: string): Promise<void> {
	const installedTombstone = !deletedSessions.has(sessionId);
	deletedSessions.set(sessionId, resolve(cwd));
	let liveEntry: Entry | undefined;
	try {
		await attaching.get(sessionId)?.catch(() => {});
		const entry = sessions.get(sessionId);
		if (entry && entry.cwd !== resolve(cwd)) {
			throw new Error(`Unknown session: ${sessionId}`);
		}
		let path: string | undefined;
		if (entry) {
			liveEntry = entry;
			if (entry.session.isStreaming) await entry.session.abort();
			const manager = entry.session.sessionManager;
			if (manager.getSessionId() !== sessionId || manager.getCwd() !== cwd) {
				throw new Error(`Session transcript scope mismatch: ${sessionId}`);
			}
			path = manager.getSessionFile();
			if (manager.isPersisted() && !path) {
				throw new Error(`Persisted session has no transcript path: ${sessionId}`);
			}
		} else {
			path = (await listSessionInfosStrict(cwd)).find(
				(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
			)?.path;
		}
		if (path && existsSync(path)) await sessionFileRemover(path);
	} catch (error) {
		if (installedTombstone) deletedSessions.delete(sessionId);
		throw error;
	}
	if (liveEntry && sessions.get(sessionId) === liveEntry) await disposeSession(sessionId);
	publishDeleted(sessionId);
}
