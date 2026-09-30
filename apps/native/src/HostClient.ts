import type {CommandOutput, SessionResources} from './resourceGroups';
import {unreadCompletion, type SessionStateRecord, type SessionStates} from './sessionAttention';
import {useSyncExternalStore} from 'react';
import {appendCompactionFailure, compactionIds, foldCompactionEvent, type CompactionState} from './compactionModel';
import {needsCompactionSync, reconcileCompactionMessages, transcriptSyncDecision} from './compactionSync';
import {queuedText} from './compactChatCommand';
import type {PiEvent, SessionQueueContent, SessionQueueState} from '../../../packages/contracts/src';
import {toast} from './toast';
import type {ExistingWorktreeCandidate, TemplateReadLocation, JbcentralAction, JbcentralActionResult, JbcentralInstall, JbcentralLoginResult, JbcentralQuotaSnapshot, JbcentralStatus, SlashCommandInfo} from '../../../packages/contracts/src';
import {foldLoginFrame, type LoginPush, type LoginState} from './providerLoginState';
import {setThemePreference} from './Theme';
import type {SubmitBehavior} from './composerSubmission';
import {hydrateToolResults, updateToolResults, type ToolResults} from './chatActivityModel';
import {reconcileUserMessage} from './messageActionModel';
import {parseReviewFix} from './reviewPackageModel';
import {promptContent} from './promptImageModel';
import type {ToolImage} from './toolResultContent';

const noWorkspaces: Workspace[] = [];
export const workspacesOf = (state: ClientState, projectId = state.projectId) => state.projectWorkspaces[projectId] ?? noWorkspaces;
export const activeWorkspace = (state: ClientState) => workspacesOf(state).find(item => item.id === state.workspaceId);

const clientId = `react-native-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

export type Project = {id: string; name: string; path: string; lastOpened?: number; closed?: true; trusted?: boolean; disabledGroups?: string[]};
export type Workspace = {id: string; projectId: string; name: string; branch: string; worktreePath: string; kind?: string; baseBranch?: string; diffBase?: string; subagentsOverride?: 'on' | 'off' | null};
export type EditorInfo = {id: string; label: string; kind: 'gui' | 'terminal'};
export type Model = {id: string; provider: string; name: string; thinkingLevels: string[]; contextWindow: number; reasoning: boolean};
export type Session = {sessionId: string; workspaceId: string; title: string; isStreaming: boolean; updatedAt: number; model?: Model | null; thinkingLevel?: string; openTodos?: number; queue?: SessionQueueState};
export type FileNode = {path: string; name: string; kind: 'file' | 'dir'; gitignored?: boolean};
export type Change = {path: string; status: string; added?: number; removed?: number};
export type DiffScope = {kind: 'branch'} | {kind: 'uncommitted'} | {kind: 'commit'; sha: string};
export type GitCommit = {sha: string; shortSha: string; subject: string};
export type BranchList = {local: string[]; remote: string[]; remoteGroups?: {remote: string | null; branches: {ref: string; branch: string}[]}[]; defaultBranch: string};
export type SpecNode = {id: string; title: string; type: string; status?: string; path: string; parent?: string};
export type ReviewComment = {id: string; body: string; status: string; anchor?: {path?: string} | null};
export type Todo = {id: string; title: string; status: string};
export type Skill = {name: string; description?: string; decision: string};
export type SkillCatalogEntry = {name: string; description?: string; plugin?: string; group: string; decision: 'load' | 'untrusted' | 'pending-ack' | 'disabled'};
export type ChatMessage = {role: string; content?: unknown; summary?: string; customType?: string; details?: unknown; tokensBefore?: number; compaction?: CompactionState; compactionId?: number};
export type ProviderStatus = {id: string; name: string; configured: boolean; kind?: string; detail?: string; canOAuth?: boolean; canApiKey?: boolean; canLogout?: boolean};
export type ProviderStatusReport = {providers: ProviderStatus[]; jbcentral: JbcentralStatus; jbcentralInstall: JbcentralInstall};
export type GithubAuthStatus = {connected: boolean; login?: string};
export type TemplateScope = 'global' | 'project';
export type TemplateInfo = {name: string; scope: TemplateScope; description?: string; argumentHint?: string; filePath: string};
export type Template = TemplateInfo & {content: string};
export type AppConfig = {
  theme: string; themeMode: 'fixed' | 'system'; systemThemePair?: {light: string; dark: string};
  analyticsEnabled: boolean; analyticsConsentConfirmed: boolean; terminalReplayKb: number; composerGrowthLimit: 'compact' | 'roomy' | 'half-chat';
  chatLineWidth: number; fileLineWidth: number; chatLineWidthBounded: boolean; fileLineWidthBounded: boolean;
  reviewAutoFix: boolean; agentReviewEnabled: boolean; subagentsEnabled: boolean;
  defaultModel?: Model; defaultEffort?: string;
  reviewModel?: Model; reviewEffort?: string;
  jbcentralQuotaEnabled: boolean; jbcentralQuotaRefreshSeconds: number;
};
type AppConfigUpdate = Partial<Omit<AppConfig, 'defaultModel' | 'defaultEffort' | 'reviewModel' | 'reviewEffort'>> & {
  defaultModel?: Model | null; defaultEffort?: string | null; reviewModel?: Model | null; reviewEffort?: string | null;
};
type TerminalTab = {tabKey: string; title: string};
type TerminalInstance = {id: string; output: string};
const highestTerminalNumber = (tabs: TerminalTab[]) => Math.max(0,
  ...tabs.map(tab => Number(/^Terminal (\d+)$/.exec(tab.title)?.[1] ?? 0)));

export type ClientState = {
  connection: 'connecting' | 'connected' | 'disconnected';
  error: string;
  config?: AppConfig;
  login?: LoginState;
  providerRevision: number;
  projects: Project[];
  recentProjects: Project[];
  projectWorkspaces: Record<string, Workspace[]>;
  interviewPrompt: boolean;
  editors: EditorInfo[];
  projectId: string;
  workspaceId: string;
  sessions: Session[];
  sessionsFor: string;
  removedSessionIds: string[];
  sessionStates: SessionStates;
  resourcesRevision: number;
  models: Model[];
  skills: Skill[];
  sessionId: string;
  messages: ChatMessage[];
  toolResults: ToolResults;
  streamingMessage?: ChatMessage;
  streaming: boolean;
  queue: SessionQueueState;
  files: FileNode[];
  folders: Record<string, FileNode[]>;
  expanded: string[];
  filePath: string;
  fileContent: string;
  changes: Change[];
  diffScope: DiffScope;
  diffPath: string;
  diffOriginal: string;
  diffModified: string;
  specs: SpecNode[];
  reviews: ReviewComment[];
  todos: Todo[];
  stats?: {tokens: {total: number}; cost: number};
  terminalTabs: TerminalTab[];
  terminalInstances: Record<string, TerminalInstance>;
};

const emptyState: ClientState = {
  connection: 'connecting', error: '', providerRevision: 0, projects: [], recentProjects: [], projectWorkspaces: {}, interviewPrompt: false, editors: [], projectId: '', workspaceId: '',
  sessions: [], sessionsFor: '', removedSessionIds: [], sessionStates: {}, resourcesRevision: 0, models: [], skills: [], sessionId: '', messages: [], toolResults: {}, streaming: false, queue: {steering: [], followUp: []}, files: [], folders: {}, expanded: [],
  filePath: '', fileContent: '', changes: [], diffScope: {kind: 'branch'}, diffPath: '', diffOriginal: '', diffModified: '',
  specs: [], reviews: [], todos: [], terminalTabs: [], terminalInstances: {},
};

type Pending = {resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout>};
type Frame = {id?: string; ok?: boolean; result?: unknown; error?: string; channel?: string; data?: unknown};

class HostClient {
  private state = emptyState;
  private listeners = new Set<() => void>();
  private socket?: InstanceType<typeof WebSocket>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private startupRetryUntil = 0;
  private pending = new Map<string, Pending>();
  private terminalAttaches = new Map<string, Promise<void>>();
  private requestPrefix = `native-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private sequence = 0;
  private terminalNumber = 0;
  private selectionHistory: string[] = [];
  private generation = 0;
  private shownSessionId = '';
  private acknowledging = '';
  private transcriptRevision = 0;
  private compactionSync?: Promise<void>;
  private url = '';
  private preferredWorkspaceId = '';
  private preferredProjectId = '';

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;
  get hostURL() { return this.url; }

  private set(patch: Partial<ClientState>) {
    if ('messages' in patch || 'streamingMessage' in patch || 'sessionId' in patch) this.transcriptRevision++;
    this.state = {...this.state, ...patch};
    this.listeners.forEach(listener => listener());
  }

  private run(task: Promise<unknown>) {
    task.catch(error => {
      if (this.state.connection === 'connected') this.set({error: String(error)});
    });
  }

  start(url: string, preferredWorkspaceId = '', preferredProjectId = '') {
    this.stop();
    this.url = url;
    this.preferredWorkspaceId = preferredWorkspaceId;
    this.preferredProjectId = preferredProjectId;
    this.startupRetryUntil = Date.now() + 1000;
    this.set({...emptyState, connection: url ? 'connecting' : 'disconnected'});
    if (url) this.connect();
  }

  stop() {
    this.generation++;
    this.startupRetryUntil = 0;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Host disconnected'));
    }
    this.pending.clear();
  }

  private connect() {
    const generation = ++this.generation;
    const socket = new WebSocket(`${this.url.replace(/^http/, 'ws')}/ws?client=${clientId}&protocol=70`);
    this.socket = socket;
    socket.onmessage = event => {
      let frame: Frame;
      try { frame = JSON.parse(String(event.data)); } catch { return; }
      if (frame.id) {
        const entry = this.pending.get(frame.id);
        if (!entry) return;
        this.pending.delete(frame.id);
        clearTimeout(entry.timer);
        if (frame.ok) entry.resolve(frame.result);
        else entry.reject(new Error(frame.error ?? 'Host request failed'));
      } else if (frame.channel) this.onPush(frame.channel, frame.data, generation);
    };
    socket.onclose = () => {
        if (this.socket !== socket) return;
      this.socket = undefined;
      this.set({connection: 'disconnected', login: undefined});
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Host disconnected'));
      }
      this.pending.clear();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        this.set({connection: 'connecting'});
        this.connect();
      }, Date.now() < this.startupRetryUntil ? 25 : 500);
    };
    socket.onerror = () => socket.close();
  }

  private request<T>(method: string, params: object, timeoutMs = 15000): Promise<T> {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Host is not connected'));
    const id = `${this.requestPrefix}-${++this.sequence}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {resolve: value => resolve(value as T), reject, timer});
      this.socket?.send(JSON.stringify({id, method, params}));
    });
  }

  private onPush(channel: string, data: unknown, generation: number) {
    if (channel === 'server.welcome') {
      const welcome = data as {protocolVersion?: number; config?: AppConfig; recentProjects?: Project[]};
      if (welcome.protocolVersion !== 75) {
        this.set({error: `Host protocol ${welcome.protocolVersion ?? '?'} is incompatible with this client`});
        this.socket?.close();
        return;
      }
      this.set({interviewPrompt: false});
      setThemePreference(welcome.config);
      this.startupRetryUntil = 0;
      this.set({connection: 'connected', error: '', config: welcome.config, recentProjects: welcome.recentProjects ?? []});
      this.run(this.hydrate(generation));
    } else if (channel === 'project.updated') {
      const project = data as Project;
      const sort = (items: Project[]) => items.sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
      const recentProjects = sort([project, ...this.state.recentProjects.filter(item => item.id !== project.id)]);
      const projects = sort(project.closed
        ? this.state.projects.filter(item => item.id !== project.id)
        : [project, ...this.state.projects.filter(item => item.id !== project.id)]);
      this.set({projects, recentProjects});
      if (project.closed && project.id === this.state.projectId) {
        if (projects[0]) this.run(this.selectProject(projects[0].id));
        else this.set({projectId: '', workspaceId: '', sessions: [], sessionId: '', messages: [], toolResults: {}, files: [], changes: [], specs: []});
      }
    } else if (channel === 'settings.changed') {
      setThemePreference(data as AppConfig);
      this.set({config: data as AppConfig});
    } else if (channel === 'provider.login') {
      const push = data as LoginPush;
      const current = this.state.login;
      if (current && current.loginId !== push.loginId && current.status === 'active') return;
      this.set({login: foldLoginFrame(current?.loginId === push.loginId ? current
        : {loginId: push.loginId, providerId: push.providerId, status: 'active'}, push.frame)});
    } else if (channel === 'provider.changed') {
      this.set({providerRevision: this.state.providerRevision + 1});
    } else if (channel === 'pi.event') {
      this.onPiEvent(data as {sessionId: string; event: Record<string, unknown>});
    } else if (channel === 'terminal.data') {
      const push = data as {id: string; data: string};
      const tabKey = Object.keys(this.state.terminalInstances).find(key => this.state.terminalInstances[key].id === push.id);
      if (tabKey) {
        const terminal = this.state.terminalInstances[tabKey];
        this.set({terminalInstances: {...this.state.terminalInstances,
          [tabKey]: {...terminal, output: (terminal.output + push.data).slice(-30000)}}});
      }
    } else if (channel === 'terminal.tabs') {
      const push = data as {workspaceId: string; tabs: TerminalTab[]};
      if (push.workspaceId === this.state.workspaceId) {
        this.terminalNumber = Math.max(this.terminalNumber, highestTerminalNumber(push.tabs));
        this.set({terminalTabs: push.tabs, terminalInstances: Object.fromEntries(
          Object.entries(this.state.terminalInstances).filter(([key]) => push.tabs.some(tab => tab.tabKey === key)))});
      }
    } else if (channel === 'workspace.fsChanged') {
      if ((data as {workspaceId: string}).workspaceId === this.state.workspaceId) this.run(this.refreshWorkspaceReads());
    } else if (channel === 'workspace.created' || channel === 'workspace.updated') {
      const workspace = data as Workspace;
      if (workspace.projectId in this.state.projectWorkspaces) this.run(this.refreshWorkspaces(workspace.projectId));
    } else if (channel === 'workspace.removed') {
      const removed = data as {projectId: string; id: string};
      this.run(this.applyWorkspaceRemoved(removed.projectId, removed.id));
    } else if (channel === 'feedback.interview') {
      this.set({interviewPrompt: true});
    } else if (channel === 'session.resourcesChanged') {
      if ((data as {sessionId: string}).sessionId === this.state.sessionId) this.set({resourcesRevision: this.state.resourcesRevision + 1});
    } else if (channel === 'session.state') {
      const record = data as SessionStateRecord;
      this.set({sessionStates: {...this.state.sessionStates, [record.sessionId]: record}});
      this.acknowledgeShownCompletion();
    } else if (channel === 'session.deleted') {
      const {sessionId} = data as {sessionId: string};
      this.markSessionsRemoved([sessionId]);
      this.set({sessionStates: Object.fromEntries(Object.entries(this.state.sessionStates).filter(([id]) => id !== sessionId))});
      this.run(this.refreshSessions());
    } else if (channel === 'session.created') {
      this.run(this.refreshSessions());
    } else if (channel === 'review.changed') {
      this.run(this.refreshReviews());
    }
  }

  private async hydrate(generation: number) {
    try {
      this.run(this.request<Model[]>('model.list', {}).then(models => {
        if (generation === this.generation) this.set({models});
      }));
      this.run(this.request<EditorInfo[]>('editor.list', {}).then(editors => {
        if (generation === this.generation) this.set({editors});
      }));
      this.run(this.request<SessionStateRecord[]>('session.stateList', {}).then(records => {
        if (generation !== this.generation) return;
        this.set({sessionStates: {...Object.fromEntries(records.map(record => [record.sessionId, record])), ...this.state.sessionStates}});
        this.acknowledgeShownCompletion();
      }));
      const projects = await this.request<Project[]>('project.list', {});
      if (generation !== this.generation) return;
      this.set({projects});
      const projectId = projects.find(project => project.id === this.state.projectId)?.id
        ?? projects.find(project => project.id === this.preferredProjectId)?.id ?? projects[0]?.id;
      if (projectId) await this.selectProject(projectId, this.state.workspaceId || undefined);
    } catch (error) { this.set({error: String(error)}); }
  }

  async selectProject(projectId: string, selectedWorkspaceId?: string) {
    this.set({projectId, workspaceId: '', sessions: [], sessionId: '', messages: [], toolResults: {}, skills: []});
    try {
      this.run(this.request<Skill[]>('project.skills', {projectId}).then(skills => {
        if (this.state.projectId === projectId) this.set({skills});
      }));
      const workspaces = await this.loadProjectWorkspaces(projectId);
      if (this.state.projectId !== projectId) return;
      const selected = workspaces.find(workspace => workspace.id === selectedWorkspaceId)
        ?? workspaces.find(workspace => workspace.id === this.preferredWorkspaceId);
      if (selected) await this.selectWorkspace(selected.id);
    } catch (error) { this.set({error: String(error)}); }
  }

  pickProjectDirectory() {
    return this.request<{path: string | null}>('dialog.selectDirectory', {}, 30 * 60_000);
  }

  private async adoptProject(project: Project, isCurrent: () => boolean) {
    if (!isCurrent()) return;
    const projects = await this.request<Project[]>('project.list', {});
    if (!isCurrent()) return;
    this.set({projects});
    await this.selectProject(project.id);
  }

  async openProject(path: string, isCurrent: () => boolean = () => true) {
    const project = await this.request<Project>('project.open', {path});
    await this.adoptProject(project, isCurrent);
    return project;
  }

  inspectProject(path: string) {
    return this.request<{kind: 'repo' | 'initable' | 'missing' | 'notDirectory'}>('project.inspect', {path});
  }

  async initProject(path: string, isCurrent: () => boolean) {
    const project = await this.request<Project>('project.init', {path});
    await this.adoptProject(project, isCurrent);
    return project;
  }

  projectHasSpecs(projectId: string) {
    return this.request<{hasSpecs: boolean}>('project.hasSpecs', {projectId});
  }

  async enterDefaultWorkspace(projectId: string): Promise<Workspace | undefined> {
    const workspaces = await this.loadProjectWorkspaces(projectId);
    const workspace = workspaces.find(item => item.kind === 'default');
    if (!workspace) throw new Error('This host has no Default workspace for this project.');
    if (this.state.projectId !== projectId) await this.selectProject(projectId, workspace.id);
    else await this.selectWorkspace(workspace.id);
    return workspace;
  }

  async createWorktree(projectId: string, baseRef: string): Promise<Workspace> {
    const workspace = await this.request<Workspace>('workspace.create', {projectId, ...(baseRef ? {baseRef} : {})});
    await this.selectProject(projectId, workspace.id);
    return workspace;
  }

  async loadProjectWorkspaces(projectId: string) {
    const workspaces = await this.request<Workspace[]>('workspace.list', {projectId, includeDiffStats: true});
    this.set({projectWorkspaces: {...this.state.projectWorkspaces, [projectId]: workspaces}});
    return workspaces;
  }

  projectAliasSkills(projectId: string) {
    return this.request<string[]>('project.aliasSkills', {projectId});
  }

  private applyProject(project: Project) {
    this.set({projects: this.state.projects.map(item => item.id === project.id ? project : item)});
    return project;
  }

  async trustProject(projectId: string) {
    return this.applyProject(await this.request<Project>('project.setTrust', {id: projectId, trusted: true}));
  }

  skillCatalog(projectId: string, workspaceId: string) {
    return workspaceId ? this.request<SkillCatalogEntry[]>('skills.state', {workspaceId}) : this.request<SkillCatalogEntry[]>('project.skills', {projectId});
  }

  async setSkillGroupEnabled(projectId: string, group: string, enabled: boolean) {
    return this.applyProject(await this.request<Project>('project.setGroupEnabled', {id: projectId, group, enabled}));
  }

  async setSkillEnabled(projectId: string, workspaceId: string, name: string, enabled: boolean) {
    if (workspaceId) await this.request('workspace.setSkillOverride', {id: workspaceId, name, override: enabled ? 'on' : 'off'});
    else this.applyProject(await this.request<Project>('project.setSkillEnabled', {id: projectId, name, enabled}));
  }

  async acknowledgeSkill(projectId: string, name: string) {
    return this.applyProject(await this.request<Project>('project.acknowledgeSkills', {id: projectId, names: [name]}));
  }

  reloadSessionResources(sessionId: string) { return this.request('session.reloadResources', {sessionId}); }

  sessionResources(workspaceId: string, sessionId: string) { return this.request<SessionResources>('session.resources', {workspaceId, sessionId}); }
  backgroundCommandOutput(workspaceId: string, sessionId: string, commandId: string) {
    return this.request<CommandOutput>('backgroundCommand.output', {workspaceId, sessionId, commandId});
  }
  stopBackgroundCommand(workspaceId: string, sessionId: string, commandId: string) {
    return this.request('backgroundCommand.stop', {workspaceId, sessionId, commandId});
  }
  stopSubagent(workspaceId: string, parentSessionId: string, childSessionId: string) {
    return this.request('subagent.stop', {workspaceId, parentSessionId, childSessionId});
  }
  stopAllSubagents(workspaceId: string, parentSessionId: string) { return this.request('subagent.stopAll', {workspaceId, parentSessionId}); }
  subagentTranscript(workspaceId: string, parentSessionId: string, childSessionId: string) {
    return this.request<{messages: ChatMessage[]}>('subagent.getTranscript', {workspaceId, parentSessionId, childSessionId});
  }

  prefetchRef(projectId: string, ref: string) {
    return this.request('git.prefetch', {projectId, ref});
  }

  async respondToInterview(action: 'postpone' | 'never' | 'book') {
    await this.request('feedback.respond', {action});
    this.set({interviewPrompt: false});
  }

  listExistingWorktrees(projectId: string) {
    return this.request<ExistingWorktreeCandidate[]>('workspace.listExisting', {projectId});
  }

  async openExistingWorktree(projectId: string, path: string) {
    const workspace = await this.request<Workspace>('workspace.openExisting', {projectId, path});
    await this.selectProject(projectId, workspace.id);
    return workspace;
  }

  async closeProject(id: string) {
    await this.request('project.close', {id});
  }

  private async refreshWorkspaces(projectId: string) {
    await this.loadProjectWorkspaces(projectId);
  }

  private async applyWorkspaceRemoved(projectId: string, workspaceId: string) {
    const name = workspacesOf(this.state, projectId).find(item => item.id === workspaceId)?.name;
    const wasActive = this.state.workspaceId === workspaceId;
    this.selectionHistory = this.selectionHistory.filter(id => id !== workspaceId);
    if (projectId in this.state.projectWorkspaces) {
      this.set({projectWorkspaces: {...this.state.projectWorkspaces, [projectId]: workspacesOf(this.state, projectId).filter(item => item.id !== workspaceId)}});
    }
    if (!wasActive) return;
    const fallback = this.selectionHistory.map(id => Object.values(this.state.projectWorkspaces).flat().find(item => item.id === id))
      .find(item => item !== undefined && this.state.projects.some(project => project.id === item.projectId));
    toast.info(`Workspace "${name ?? '?'}" was removed`);
    if (fallback) await this.selectProject(fallback.projectId, fallback.id);
    else await this.selectProject(projectId);
  }

  async renameWorkspace(id: string, name: string) {
    try { await this.request('workspace.rename', {id, name}); return true; }
    catch (error) {
      if (this.state.connection === 'connected') this.set({error: String(error)});
      return false;
    }
  }

  async setSubagentsOverride(id: string, override: 'on' | 'off' | null): Promise<boolean> {
    try { await this.request('workspace.setSubagentsOverride', {id, override}); return true; }
    catch (error) { this.set({error: String(error)}); return false; }
  }

  async removeWorkspace(id: string) {
    try { await this.request('workspace.remove', {id}); }
    catch (error) { this.set({error: String(error)}); }
  }

  async revealWorkspace(id: string) {
    try { await this.request('workspace.reveal', {id}); }
    catch (error) { this.set({error: String(error)}); }
  }

  async openWorkspaceIn(id: string, editor: string) {
    try { await this.request('workspace.openIn', {id, editor}); }
    catch (error) { this.set({error: String(error)}); }
  }

  async selectWorkspace(workspaceId: string) {
    this.selectionHistory = [workspaceId, ...this.selectionHistory.filter(id => id !== workspaceId)];
    this.terminalNumber = 0;
    this.set({workspaceId, sessions: [], sessionsFor: '', sessionId: '', messages: [], toolResults: {}, streamingMessage: undefined, queue: {steering: [], followUp: []},
      files: [], folders: {}, expanded: [], filePath: '', fileContent: '', changes: [], diffScope: {kind: 'branch'},
      diffPath: '', diffOriginal: '', diffModified: '', specs: [], stats: undefined,
      reviews: [], todos: [], terminalTabs: [], terminalInstances: {}});
    const knownBefore = new Set(this.knownSessions.get(workspaceId) ?? []);
    const [sessions, files, status, graph, terminals, review] = await Promise.all([
      this.request<Session[]>('session.list', {workspaceId}).catch(() => []),
      this.request<FileNode[]>('fs.readDir', {workspaceId, path: '.'}).catch(() => []),
      this.request<{changes: Change[]}>('git.status', {workspaceId, scope: {kind: 'branch'}}).catch(() => ({changes: []})),
      this.request<{nodes: SpecNode[]}>('spec.graph', {workspaceId}).catch(() => ({nodes: []})),
      this.request<{tabs: TerminalTab[]}>('terminal.list', {workspaceId}).catch(() => ({tabs: []})),
      this.request<{comments: ReviewComment[]}>('review.get', {workspaceId}).catch(() => ({comments: []})),
    ]);
    if (this.state.workspaceId !== workspaceId) return;
    this.terminalNumber = Math.max(this.terminalNumber, highestTerminalNumber(terminals.tabs));
    this.reconcileSessions(workspaceId, knownBefore, sessions);
    this.set({sessions, sessionsFor: workspaceId, files, changes: status.changes, specs: graph.nodes, terminalTabs: terminals.tabs,
      reviews: review.comments});
    const tab = terminals.tabs[0];
    if (tab) this.run(this.ensureTerminalAttached(tab.tabKey));
  }

  private async refreshWorkspaceReads() {
    const workspaceId = this.state.workspaceId;
    if (!workspaceId) return;
    const scope = this.state.diffScope;
    const [files, status, graph] = await Promise.all([
      this.request<FileNode[]>('fs.readDir', {workspaceId, path: '.'}),
      this.request<{changes: Change[]}>('git.status', {workspaceId, scope}),
      this.request<{nodes: SpecNode[]}>('spec.graph', {workspaceId}),
    ]);
    if (this.state.workspaceId === workspaceId) this.set({files, changes: this.state.diffScope === scope ? status.changes : this.state.changes, specs: graph.nodes});
  }

  private async refreshSessions() {
    const workspaceId = this.state.workspaceId;
    if (!workspaceId) return;
    const known = this.knownSessions.get(workspaceId) ?? new Set<string>();
    const sessions = await this.request<Session[]>('session.list', {workspaceId});
    this.reconcileSessions(workspaceId, known, sessions);
    if (this.state.workspaceId === workspaceId) this.set({sessions, sessionsFor: workspaceId});
  }

  private readonly knownSessions = new Map<string, Set<string>>();

  private reconcileSessions(workspaceId: string, before: Set<string>, sessions: Session[]) {
    const listed = new Set(sessions.map(session => session.sessionId));
    this.markSessionsRemoved([...before].filter(id => !listed.has(id)));
    this.knownSessions.set(workspaceId, listed);
  }

  private markSessionsRemoved(ids: string[]) {
    const fresh = ids.filter(id => !this.state.removedSessionIds.includes(id));
    if (fresh.length) this.set({removedSessionIds: [...this.state.removedSessionIds, ...fresh]});
  }

  async deleteSession(sessionId: string) {
    const workspaceId = this.state.workspaceId;
    try {
      await this.request('session.delete', {workspaceId, sessionId});
      await this.refreshSessions();
    } catch (error) {
      toast.error(String(error instanceof Error ? error.message : error), "Couldn't delete chat");
    }
  }

  private async refreshReviews() {
    if (!this.state.workspaceId) return;
    const review = await this.request<{comments: ReviewComment[]}>('review.get', {workspaceId: this.state.workspaceId});
    this.set({reviews: review.comments});
  }

  private acknowledgeShownCompletion() {
    const sessionId = this.state.sessionId;
    const completionId = sessionId && this.shownSessionId === sessionId ? unreadCompletion(this.state.sessionStates, sessionId) : undefined;
    if (!completionId || this.acknowledging === completionId) return;
    this.acknowledging = completionId;
    this.run(this.request<{record: SessionStateRecord}>('session.acknowledgeCompletion', {sessionId, completionId}).then(({record}) => {
      this.set({sessionStates: {...this.state.sessionStates, [record.sessionId]: record}});
    }).finally(() => {if (this.acknowledging === completionId) this.acknowledging = '';}));
  }

  async selectSession(sessionId: string): Promise<boolean> {
    const workspaceId = this.state.workspaceId;
    this.shownSessionId = '';
    this.set({sessionId, messages: [], toolResults: {}, streamingMessage: undefined, todos: [], stats: undefined,
      queue: this.state.sessions.find(session => session.sessionId === sessionId)?.queue ?? {steering: [], followUp: []},
      streaming: this.state.sessions.find(session => session.sessionId === sessionId)?.isStreaming ?? false});
    const initialQueue = this.state.queue;
    try {
      const [transcript, plan, stats] = await Promise.all([
        this.request<{summary: Session; messages: ChatMessage[]}>('session.getMessages', {workspaceId, sessionId}),
        this.request<{todos: Todo[]}>('todo.list', {workspaceId, sessionId}).catch(() => ({todos: []})),
        this.request<{tokens: {total: number}; cost: number}>('session.getStats', {sessionId}).catch(() => undefined),
      ]);
      if (this.state.workspaceId === workspaceId && this.state.sessionId === sessionId) {
        this.set({messages: transcript.messages, queue: this.state.queue === initialQueue ? transcript.summary.queue ?? {steering: [], followUp: []} : this.state.queue,
          toolResults: {...hydrateToolResults(transcript.messages), ...this.state.toolResults}, todos: plan.todos, stats});
        this.shownSessionId = sessionId;
        this.acknowledgeShownCompletion();
      }
      return true;
    } catch (error) {
      if (this.state.sessionId === sessionId) this.set({sessionId: ''});
      if (this.state.connection === 'connected') toast.error(error instanceof Error ? error.message : String(error), "Couldn't open chat");
      return false;
    }
  }

  async createSession(options: {model?: Model; thinkingLevel?: string} = {}) {
    if (!this.state.workspaceId) return;
    const workspaceId = this.state.workspaceId;
    try {
      const created = await this.request<{sessionId: string}>('session.create', {workspaceId, ...options});
      if (this.state.workspaceId !== workspaceId) return;
      this.set({sessionId: created.sessionId, messages: [], toolResults: {}, streamingMessage: undefined,
        streaming: false, todos: [], stats: undefined});
      this.run(this.refreshSessions());
      return created.sessionId;
    } catch (error) { this.set({error: String(error)}); }
  }

  async setModel(model: Model) {
    if (!this.state.sessionId) return;
    try {
      await this.request('session.setModel', {sessionId: this.state.sessionId, model});
      await this.refreshSessions();
    } catch (error) { this.set({error: String(error)}); }
  }

  async refreshModels(force: boolean) {
    const generation = this.generation;
    const result = await this.request<{models: Model[]}>('model.refresh', {force});
    if (generation === this.generation) this.set({models: result.models});
  }

  defaultModel() { return this.request<{model: Model | null; thinkingLevel: string}>('model.default', {}); }

  async updateConfig(config: AppConfigUpdate): Promise<boolean> {
    try { await this.request('settings.update', {config}); return true; }
    catch (error) { this.set({error: String(error)}); return false; }
  }

  providerStatus() { return this.request<ProviderStatusReport>('provider.status', {}); }
  jbcentralQuota(force = false) { return this.request<JbcentralQuotaSnapshot>('provider.jbcentralQuota', force ? {force: true} : {}); }
  jbcentralAction(action: JbcentralAction) {
    const methods = {connect: 'provider.jbcentralConnect', disconnect: 'provider.jbcentralDisconnect', 'start-proxy': 'provider.jbcentralStartProxy', update: 'provider.jbcentralUpdate'};
    return this.request<JbcentralActionResult>(methods[action], {});
  }
  jbcentralLogin() { return this.request<JbcentralLoginResult>('provider.jbcentralLogin', {}); }
  async startProviderLogin(providerId: string, type: 'oauth' | 'api_key') {
    const {loginId} = await this.request<{loginId: string}>('provider.loginStart', {providerId, type});
    if (this.state.login?.loginId !== loginId) this.set({login: {loginId, providerId, status: 'active'}});
  }
  async replyProviderLogin(value: string) {
    const login = this.state.login;
    if (!login) return;
    this.set({login: {...login, input: undefined}});
    try {await this.request('provider.loginReply', {loginId: login.loginId, value});}
    catch (error) {
      if (this.state.login?.loginId === login.loginId && !this.state.login.input && this.state.login.status === 'active') {
        this.set({login});
      }
      throw error;
    }
  }
  async cancelProviderLogin() {
    const login = this.state.login;
    this.set({login: undefined});
    if (login?.status === 'active') await this.request('provider.loginCancel', {loginId: login.loginId});
  }
  clearProviderLogin() { this.set({login: undefined}); }
  async logoutProvider(providerId: string) {
    await this.request('provider.logout', {providerId});
    this.set({providerRevision: this.state.providerRevision + 1});
  }
  githubStatus() { return this.request<GithubAuthStatus>('github.authStatus', {}); }
  refreshGithub() { return this.request<GithubAuthStatus>('github.refresh', {}); }
  fileURL(path: string) {
    if (!this.url || !this.state.workspaceId) return undefined;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    return `${this.url.replace(/\/$/, '')}/files/${encodeURIComponent(this.state.workspaceId)}/${encodedPath}`;
  }
  listTemplates(location: TemplateReadLocation) { return this.request<{templates: TemplateInfo[]}>('template.list', location); }
  listSkillCommands(projectId: string) { return this.request<SlashCommandInfo[]>('skill.list', {projectId}); }
  reportError(error: string) { this.set({error}); }
  sessionCommands(sessionId: string) { return this.request<SlashCommandInfo[]>('session.getCommands', {sessionId}); }
  getTemplate(template: TemplateInfo, location: TemplateReadLocation) {
    return this.request<Template>('template.get', {name: template.name, scope: template.scope, ...location});
  }
  saveTemplate(name: string, scope: TemplateScope, content: string, workspaceId?: string) {
    return this.request<Template>('template.save', {name, scope, content, ...(workspaceId ? {workspaceId} : {})});
  }
  deleteTemplate(template: TemplateInfo, workspaceId?: string) {
    return this.request('template.delete', {name: template.name, scope: template.scope, ...(workspaceId ? {workspaceId} : {})});
  }

  async setThinkingLevel(level: string) {
    if (!this.state.sessionId) return;
    try {
      await this.request('session.setThinkingLevel', {sessionId: this.state.sessionId, level});
      await this.refreshSessions();
    } catch (error) { this.set({error: String(error)}); }
  }

  async renameSession(workspaceId: string, sessionId: string, title: string) {
    try {
      await this.request('session.rename', {workspaceId, sessionId, title});
    } catch (error) {
      if (this.state.workspaceId === workspaceId && this.state.sessionId === sessionId) {
        this.set({messages: [...this.state.messages, {role: 'error', content: String(error)}]});
      } else this.set({error: String(error)});
    }
  }

  async compactSession(workspaceId: string, sessionId: string, instructions: string, restore: (text: string) => void) {
    const observed = compactionIds(this.state.messages);
    try {
      const content = await this.request<SessionQueueContent>('session.clearQueue', {sessionId, requireTextOnly: true});
      const text = queuedText(content);
      if (text.trim()) restore(text);
      await this.request('session.compact', {sessionId, ...(instructions ? {instructions} : {})}, 60000);
    } catch (error) {
      if (this.state.workspaceId === workspaceId && this.state.sessionId === sessionId) {
        this.set({messages: appendCompactionFailure(this.state.messages, observed, String(error))});
      } else this.set({error: String(error)});
    }
  }

  private transcriptContext() {
    return {workspaceId: this.state.workspaceId, sessionId: this.state.sessionId, generation: this.generation,
      revision: this.transcriptRevision, connected: this.state.connection === 'connected', streaming: this.state.streaming};
  }

  private syncCompactionTranscript() {
    if (this.compactionSync || !needsCompactionSync(this.state.messages)) return;
    const context = this.transcriptContext();
    const synchronize = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = this.transcriptContext();
        if (transcriptSyncDecision(context, before, false) === 'stale') return 'stale';
        if (before.streaming) return 'wait';
        try {
          const transcript = await this.request<{summary: Session; messages: ChatMessage[]}>('session.getMessages', {workspaceId: context.workspaceId, sessionId: context.sessionId});
          const decision = transcriptSyncDecision(before, this.transcriptContext(), transcript.summary.isStreaming);
          if (decision === 'stale' || decision === 'wait') return decision;
          if (decision === 'apply') {
            const messages = reconcileCompactionMessages(this.state.messages, transcript.messages);
            this.set({messages, toolResults: hydrateToolResults(messages), queue: transcript.summary.queue ?? {steering: [], followUp: []}});
            return;
          }
        } catch (error) {
          if (transcriptSyncDecision(context, this.transcriptContext(), false) === 'stale') return 'stale';
          if (attempt === 2) this.set({error: String(error)});
        }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 500 : 1500));
      }
    };
    this.compactionSync = synchronize().then(outcome => {
      this.compactionSync = undefined;
      const current = this.transcriptContext();
      if (current.connected && !current.streaming && (outcome === 'stale' || (outcome === 'wait' && current.revision !== context.revision))) this.syncCompactionTranscript();
    });
  }

  async prompt(text: string, behavior: SubmitBehavior = this.state.streaming ? 'steer' : 'send', images: ToolImage[] = []) {
    if ((!text.trim() && !images.length) || !this.state.workspaceId) return false;
    if (!this.state.sessionId) await this.createSession();
    const sessionId = this.state.sessionId;
    if (!sessionId) return false;
    try {
      if (behavior === 'interrupt') await this.request('session.abort', {sessionId});
      if ((behavior === 'send' || behavior === 'interrupt') && this.state.sessionId === sessionId) this.set({messages: [...this.state.messages, {role: 'user', content: promptContent(text, images)}]});
      const method = behavior === 'steer' ? 'session.steer' : behavior === 'followUp' ? 'session.followUp' : 'session.prompt';
      await this.request(method, {sessionId, text, ...(images.length ? {images} : {})});
      return true;
    } catch (error) { this.set({error: String(error)}); return false; }
  }

  async abortSession() {
    if (!this.state.sessionId) return;
    try { await this.request('session.abort', {sessionId: this.state.sessionId}); }
    catch (error) { this.set({error: String(error)}); }
  }

  private onPiEvent(payload: {sessionId: string; event: Record<string, unknown>}) {
    if (payload.event.type === 'session_info_changed') {this.run(this.refreshSessions()); return;}
    if (payload.sessionId !== this.state.sessionId) return;
    this.transcriptRevision++;
    const event = payload.event;
    if (event.type === 'queue_update') {
      const queue = event as Extract<PiEvent, {type: 'queue_update'}>;
      this.set({queue: {steering: queue.steering, followUp: queue.followUp, ...(queue.hasImages ? {hasImages: true as const} : {})}});
      return;
    }
    const compactionMessages = foldCompactionEvent(this.state.messages, event as PiEvent);
    if (compactionMessages !== this.state.messages) this.set({messages: compactionMessages});
    if (event.type === 'compaction_end' && !event.aborted && !event.errorMessage) this.syncCompactionTranscript();
    const toolResults = updateToolResults(this.state.toolResults, event);
    if (toolResults !== this.state.toolResults) this.set({toolResults});
    if (event.type === 'agent_start') this.set({streaming: true});
    else if (event.type === 'message_start') {
      const message = event.message as ChatMessage;
      if (message.role === 'user') {
        const messages = reconcileUserMessage(this.state.messages, message);
        if (messages !== this.state.messages) this.set({messages});
      }
    } else if (event.type === 'message_update') {
      const update = event.assistantMessageEvent as {partial?: ChatMessage; message?: ChatMessage};
      const message = update.partial ?? update.message;
      if (message) this.set({streamingMessage: message});
    } else if (event.type === 'message_end') {
      const message = event.message as ChatMessage;
      if (message.role === 'assistant') this.set({messages: [...this.state.messages, message], streamingMessage: undefined});
      else if (parseReviewFix(message)) this.set({messages: [...this.state.messages, message]});
    } else if (event.type === 'agent_settled') {
      this.set({streaming: false, streamingMessage: undefined});
      this.syncCompactionTranscript();
      this.run(this.refreshSessions());
      this.run(this.request<{tokens: {total: number}; cost: number}>('session.getStats', {sessionId: payload.sessionId})
        .then(stats => this.set({stats})));
    }
  }

  async toggleFolder(path: string) {
    if (this.state.expanded.includes(path)) {
      this.set({expanded: this.state.expanded.filter(item => item !== path)});
      return;
    }
    try {
      const children = await this.request<FileNode[]>('fs.readDir', {workspaceId: this.state.workspaceId, path});
      this.set({folders: {...this.state.folders, [path]: children}, expanded: [...this.state.expanded, path]});
    } catch (error) { this.set({error: String(error)}); }
  }

  async openFile(path: string) {
    const workspaceId = this.state.workspaceId;
    this.set({filePath: path, fileContent: ''});
    try {
      const file = await this.request<{content: string}>('fs.readFile', {workspaceId, path});
      if (this.state.workspaceId === workspaceId && this.state.filePath === path) this.set({fileContent: file.content});
    } catch (error) { this.set({error: String(error)}); }
  }

  async openDiff(path: string) {
    const workspaceId = this.state.workspaceId;
    const scope = this.state.diffScope;
    this.set({diffPath: path, diffOriginal: '', diffModified: ''});
    try {
      const diff = await this.request<{original: string; modified: string}>('git.diffFile', {workspaceId, path, scope});
      if (this.state.workspaceId === workspaceId && this.state.diffPath === path && this.state.diffScope === scope) {
        this.set({diffOriginal: diff.original, diffModified: diff.modified});
      }
    } catch (error) { this.set({error: String(error)}); }
  }

  async setDiffScope(scope: DiffScope) {
    const workspaceId = this.state.workspaceId;
    if (!workspaceId) return;
    try {
      const status = await this.request<{changes: Change[]}>('git.status', {workspaceId, scope});
      if (this.state.workspaceId === workspaceId) this.set({diffScope: scope, changes: status.changes, diffPath: '', diffOriginal: '', diffModified: ''});
    } catch (error) {
      this.set({error: String(error)});
      throw error;
    }
  }

  listCommits(workspaceId: string) {
    return this.request<{commits: GitCommit[]}>('git.listCommits', {workspaceId});
  }

  listBranches(projectId: string) {
    return this.request<BranchList>('git.listBranches', {projectId});
  }

  async setDiffBase(workspaceId: string, ref: string) {
    const workspace = await this.request<Workspace>('workspace.setDiffBase', {id: workspaceId, ref});
    this.set({projectWorkspaces: {...this.state.projectWorkspaces,
      [workspace.projectId]: workspacesOf(this.state, workspace.projectId).map(item => item.id === workspaceId ? workspace : item)}});
    if (this.state.workspaceId === workspaceId) await this.refreshWorkspaceReads();
  }

  ensureTerminalAttached(tabKey: string): Promise<void> {
    if (this.state.terminalInstances[tabKey]) return Promise.resolve();
    const pending = this.terminalAttaches.get(tabKey);
    if (pending) return pending;
    const workspaceId = this.state.workspaceId;
    const tab = this.state.terminalTabs.find(item => item.tabKey === tabKey);
    if (!workspaceId || !tab) return Promise.resolve();
    const attach = this.request<{id: string; replay?: string}>('terminal.attach', {
      workspaceId, tabKey, title: tab.title, cols: 90, rows: 12,
    }).then(terminal => {
      if (this.state.workspaceId === workspaceId && this.state.terminalTabs.some(item => item.tabKey === tabKey)) {
        this.set({terminalInstances: {...this.state.terminalInstances,
          [tabKey]: {id: terminal.id, output: terminal.replay ?? ''}}});
      }
    }).catch(error => this.set({error: String(error)})).finally(() => this.terminalAttaches.delete(tabKey));
    this.terminalAttaches.set(tabKey, attach);
    return attach;
  }

  async openTerminal(): Promise<string | undefined> {
    const workspaceId = this.state.workspaceId;
    if (!workspaceId) return;
    try {
      const tabKey = `${this.requestPrefix}-terminal-${++this.sequence}`;
      const number = ++this.terminalNumber;
      const reserved = await this.request<{tab: TerminalTab}>('terminal.reserve', {
        workspaceId, tabKey, title: `Terminal ${number}`,
      });
      if (this.state.workspaceId !== workspaceId) return;
      if (!this.state.terminalTabs.some(tab => tab.tabKey === tabKey)) {
        this.set({terminalTabs: [...this.state.terminalTabs, reserved.tab]});
      }
      this.run(this.ensureTerminalAttached(tabKey));
      return tabKey;
    } catch (error) { this.set({error: String(error)}); }
  }

  async closeTerminal(tabKey: string): Promise<boolean> {
    const workspaceId = this.state.workspaceId;
    if (!workspaceId) return false;
    try {
      const result = await this.request<{closed: boolean; busy: boolean}>('terminal.close', {workspaceId, tabKey});
      if (result.busy) {this.set({error: 'The terminal has a running child process.'}); return false;}
      if (this.state.workspaceId === workspaceId) {
        this.set({terminalTabs: this.state.terminalTabs.filter(tab => tab.tabKey !== tabKey),
          terminalInstances: Object.fromEntries(Object.entries(this.state.terminalInstances).filter(([key]) => key !== tabKey))});
      }
      return true;
    } catch (error) { this.set({error: String(error)}); return false; }
  }

  async writeTerminal(tabKey: string, text: string) {
    await this.ensureTerminalAttached(tabKey);
    const id = this.state.terminalInstances[tabKey]?.id;
    if (!id) return;
    try { await this.request('terminal.write', {id, data: text}); }
    catch (error) { this.set({error: String(error)}); }
  }
}

export const hostClient = new HostClient();
export const useHostClient = () => useSyncExternalStore(hostClient.subscribe, hostClient.getSnapshot);
