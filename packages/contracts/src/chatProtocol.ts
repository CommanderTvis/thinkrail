export type SessionId = string;

export type MessageId = string;

export type ToolCallId = string;

export interface TextBlock {
	type: "text";
	text: string;
}

export interface ThinkingBlock {
	type: "thinking";
	text: string;
}

export interface ImageBlock {
	type: "image";
	data: string;
	mimeType: string;
	uri?: string;
}

export interface ResourceBlock {
	type: "resource";
	uri: string;
	name: string;
	mimeType?: string;
	title?: string;
	description?: string;
	size?: number;
	text?: string;
}

export type ToolKind =
	| "read"
	| "edit"
	| "delete"
	| "move"
	| "search"
	| "execute"
	| "think"
	| "fetch"
	| "switchMode"
	| "other";

export type ToolCallStatus = "pending" | "running" | "done" | "error" | "abandoned";

export interface ToolCallLocation {
	path: string;
	line?: number;
}

export type ToolOutput =
	| { type: "text"; text: string; truncated?: boolean }
	| { type: "image"; data: string; mimeType: string }
	| { type: "diff"; path: string; oldText: string | null; newText: string }
	| { type: "terminal"; terminalId: string };

export interface ToolCallBlock {
	type: "toolCall";
	toolCallId: ToolCallId;
	toolName: string;
	title: string;
	kind: ToolKind;
	status: ToolCallStatus;
	arguments: Record<string, unknown>;
	locations?: ToolCallLocation[];
	output?: ToolOutput[];
	result?: unknown;
	error?: string;
}

export type ChatBlock = TextBlock | ThinkingBlock | ImageBlock | ResourceBlock | ToolCallBlock;

export type PromptContent = TextBlock | ImageBlock | ResourceBlock;

export const SYNTHETIC_TOOL_NAME_PREFIX = "acp:";

export function isSyntheticToolName(toolName: string): boolean {
	return toolName.startsWith(SYNTHETIC_TOOL_NAME_PREFIX);
}

export type StopReason =
	| "completed"
	| "maxTokens"
	| "maxRequests"
	| "refused"
	| "cancelled"
	| "failed";

export interface TurnSettlement {
	stopReason: StopReason;
	error?: string;
}

export interface TurnSettledMarker extends TurnSettlement {
	kind: "turnSettled";
	startedAt?: number;
}

export type CompactionReason = "manual" | "threshold" | "overflow";

export interface CompactionMarker {
	kind: "compaction";
	reason: CompactionReason;
	summary: string;
	tokensBefore?: number;
}

export interface QuestionAnswersMarker {
	kind: "questionAnswers";
	toolCallId: ToolCallId;
	result: AskUserQuestionResult;
}

export type NoticeLevel = "info" | "warning" | "error";

export interface NoticeMarker {
	kind: "notice";
	level: NoticeLevel;
	text: string;
}

export type ChatMarker =
	| TurnSettledMarker
	| CompactionMarker
	| QuestionAnswersMarker
	| NoticeMarker;

export interface UserMessage {
	role: "user";
	id: MessageId;
	timestamp: number;
	content: PromptContent[];
	hidden?: boolean;
}

export interface AssistantMessage {
	role: "assistant";
	id: MessageId;
	timestamp: number;
	blocks: ChatBlock[];
	endedAt?: number;
	superseded?: boolean;
}

export interface MarkerMessage<M extends ChatMarker = ChatMarker> {
	role: "marker";
	id: MessageId;
	timestamp: number;
	marker: M;
}

export type ChatMessage = UserMessage | AssistantMessage | MarkerMessage;

export type ChatRole = ChatMessage["role"];

export type ConfigOptionCategory = "model" | "modelConfig" | "thinkingLevel" | "mode" | "other";

export interface ConfigChoiceMeta {
	contextWindow?: number;
	reasoning?: boolean;
}

export interface ConfigChoice {
	id: string;
	name: string;
	description?: string;
	meta?: ConfigChoiceMeta;
}

export interface ConfigOptionGroup {
	id: string;
	name: string | null;
	choices: ConfigChoice[];
}

export interface ConfigSelect {
	type: "select";
	value: string;
	groups: ConfigOptionGroup[];
}

export interface ConfigToggle {
	type: "toggle";
	value: boolean;
}

export interface ConfigOption {
	id: string;
	name: string;
	description?: string;
	category: ConfigOptionCategory;
	control: ConfigSelect | ConfigToggle;
}

export type ConfigValue = string | boolean;

export interface ConfigSummary {
	optionId: string;
	category: ConfigOptionCategory;
	value: ConfigValue;
	valueName: string;
}

export interface Money {
	amount: number;
	currency: string;
}

export interface TokenUsage {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
	thought?: number;
}

export interface SessionUsage {
	contextUsed: number | null;
	contextWindow: number | null;
	tokens?: TokenUsage;
	cost?: Money;
}

export type AgentPlanEntryStatus = "pending" | "active" | "done";

export type AgentPlanEntryPriority = "high" | "medium" | "low";

export interface AgentPlanEntry {
	text: string;
	status: AgentPlanEntryStatus;
	priority?: AgentPlanEntryPriority;
}

export interface AgentPlan {
	entries: AgentPlanEntry[];
}

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandSourceInfo {
	path: string;
	source: string;
	scope: "user" | "project" | "temporary";
	origin: "package" | "top-level";
	baseDir?: string;
}

export interface SlashCommand {
	name: string;
	description?: string;
	source?: SlashCommandSource;
	sourceInfo?: SlashCommandSourceInfo;
	argumentHint?: string;
}

export type SkillDecision = "load" | "untrusted" | "pending-ack" | "disabled";

export interface SkillCatalogEntry {
	name: string;
	description?: string;
	sourceInfo: SlashCommandSourceInfo;
	gated: boolean;
	plugin?: string;
	group: string;
	decision: SkillDecision;
}

export type AgentOrigin = "bundled" | "installed" | "external";

export interface AgentDescriptor {
	id: string;
	name: string;
	version?: string;
	origin: AgentOrigin;
	protocolVersion?: number;
	icon?: string;
}

export type AgentDistribution =
	| { kind: "npx"; package: string; args?: string[]; env?: Record<string, string> }
	| { kind: "uvx"; package: string; args?: string[]; env?: Record<string, string> }
	| {
			kind: "binary";
			archive: string;
			command: string;
			args: string[];
			env?: Record<string, string>;
			sha256?: string;
	  };

export interface AgentRegistryEntry {
	id: string;
	name: string;
	version: string;
	description?: string;
	repository?: string;
	authors?: string[];
	license?: string;
	icon?: string;
	distribution: AgentDistribution | null;
	installed: boolean;
	installedVersion?: string;
	notRecommended?: string;
}

export type DetectedAgentSource = "path" | "npx" | "uvx";

export interface DetectedAgent {
	id: string;
	name: string;
	icon?: string;
	command: string;
	args: string[];
	source: DetectedAgentSource;
	detail: string;
}

export interface InstalledAgent extends AgentDescriptor {
	command: string;
	args: string[];
	capabilities?: ChatCapabilities;
	unavailable?: string;
}

export interface AgentAuthMethod {
	id: string;
	name: string;
	description?: string;
	kind: "agent" | "envVar" | "terminal";
	link?: string;
	envVars?: AgentAuthEnvVar[];
	terminalArgs?: string[];
	terminalEnv?: Record<string, string>;
}

export interface AgentAuthEnvVar {
	name: string;
	label?: string;
	secret?: boolean;
	optional?: boolean;
}

export type AgentAuthResult =
	| { outcome: "ok" }
	| { outcome: "terminal"; workspaceId: string; terminalId: string }
	| { outcome: "failed"; error: string };

export interface AgentProviderInfo {
	id: string;
	name?: string;
	required: boolean;
	configured: boolean;
	protocols: string[];
	baseUrl?: string;
}

export type AgentStatus =
	| { phase: "spawning" }
	| { phase: "ready" }
	| { phase: "crashed"; error: string; exitCode: number | null; willRestart: boolean }
	| { phase: "restarting"; attempt: number }
	| { phase: "unavailable"; error: string };

export type SteeringSupport = "native" | "queued" | "none";

export type PlanSource = "thinkrail" | "agent" | "none";

export type McpToolDelivery = "native" | "acp" | "http" | "none";

export interface ChatCapabilityFlags {
	imageInput: boolean;
	embeddedContext: boolean;
	steering: SteeringSupport;
	followUp: boolean;
	slashCommands: boolean;
	promptTemplates: boolean;
	modelPicker: boolean;
	thinkingLevel: boolean;
	modes: boolean;
	configRefresh: boolean;
	cost: boolean;
	tokenBreakdown: boolean;
	contextWindow: boolean;
	plan: PlanSource;
	elicitation: boolean;
	permissions: boolean;
	skills: boolean;
	workflowSkills: boolean;
	mcpTools: McpToolDelivery;
	fileDelegation: boolean;
	terminalDelegation: boolean;
	sessionList: boolean;
	sessionLoad: boolean;
	sessionFork: boolean;
	sessionClose: boolean;
	retryVisibility: boolean;
	compactionVisibility: boolean;
	queueDepth: boolean;
	authentication: boolean;
	logout: boolean;
	providerConfig: boolean;
	jetbrainsCentral: boolean;
}

export type CapabilitySource = "agent" | "meta" | "registry" | "host" | "observed";

export interface ChatCapabilities extends ChatCapabilityFlags {
	agent: AgentDescriptor;
	derivedFrom: Partial<Record<keyof ChatCapabilityFlags, CapabilitySource>>;
}

export interface SessionRecord {
	sessionId: SessionId;
	workspaceId: string;
	cwd: string;
	agentId: string;
	title: string | null;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	promptCount: number;
	lastSettlement: TurnSettlement | null;
	usage: SessionUsage | null;
	config: ConfigSummary[];
}

export type QueueLane = "steering" | "followUp";

export interface SessionQueueState {
	steering: readonly string[];
	followUp: readonly string[];
	hasImages?: true;
}

export interface SessionQueueContent {
	steering: readonly PromptContent[][];
	followUp: readonly PromptContent[][];
}

export interface RemovedQueuedMessage {
	removed: PromptContent[] | null;
	queue: SessionQueueState;
}

export interface SessionSummary {
	record: SessionRecord;
	agent: AgentDescriptor;
	isStreaming: boolean;
	live: boolean;
	openTodos?: number;
	queue?: SessionQueueState;
}

export type RetryScope = "turn" | "summarization";

export type ToolCallPatch = Partial<Omit<ToolCallBlock, "type" | "toolCallId">>;

export type ChatEvent =
	| { type: "turn_start" }
	| { type: "turn_settled"; message: MarkerMessage<TurnSettledMarker> }
	| { type: "message_start"; message: ChatMessage }
	| { type: "message_end"; messageId: MessageId; endedAt: number }
	| { type: "message_superseded"; messageId: MessageId }
	| {
			type: "chunk";
			messageId: MessageId;
			index: number;
			kind: "text" | "thinking";
			delta: string;
	  }
	| { type: "block"; messageId: MessageId; index: number; block: ChatBlock }
	| { type: "tool_call_update"; toolCallId: ToolCallId; patch: ToolCallPatch }
	| { type: "config_options"; options: ConfigOption[] }
	| { type: "commands"; commands: SlashCommand[] }
	| { type: "usage"; usage: SessionUsage }
	| { type: "session_info"; title?: string; updatedAt?: number }
	| { type: "plan"; plan: AgentPlan | null }
	| { type: "capabilities"; capabilities: ChatCapabilities }
	| { type: "agent_status"; status: AgentStatus }
	| {
			type: "retry_scheduled";
			scope: RetryScope;
			attempt: number;
			maxAttempts: number;
			delayMs: number;
			error?: string;
	  }
	| { type: "retry_cleared"; scope: RetryScope }
	| { type: "compaction_start"; reason: CompactionReason }
	| { type: "compaction_end"; reason: CompactionReason; error?: string }
	| {
			type: "queue_changed";
			steering: number;
			followUp: number;
			queue?: SessionQueueState;
	  };

export interface ChatEventPayload {
	sessionId: SessionId;
	event: ChatEvent;
}

export type DurableChatEventType =
	| "turn_settled"
	| "message_start"
	| "message_end"
	| "message_superseded"
	| "chunk"
	| "block"
	| "tool_call_update"
	| "config_options"
	| "usage"
	| "session_info";

export const DURABLE_CHAT_EVENT_TYPES: readonly DurableChatEventType[] = [
	"turn_settled",
	"message_start",
	"message_end",
	"message_superseded",
	"chunk",
	"block",
	"tool_call_update",
	"config_options",
	"usage",
	"session_info",
];

export function isDurableChatEvent(event: ChatEvent): boolean {
	return (DURABLE_CHAT_EVENT_TYPES as readonly string[]).includes(event.type);
}

export interface TranscriptCorpusEntry {
	messageId: MessageId;
	role: "user" | "assistant";
	text: string;
	timestamp: number;
}

export interface TranscriptCorpusSession {
	sessionId: SessionId;
	workspaceId: string;
	cwd: string;
	title: string | null;
	entries: readonly TranscriptCorpusEntry[];
}

export interface TranscriptCorpusSnapshot {
	sessions: readonly TranscriptCorpusSession[];
	complete: boolean;
}

export interface TranscriptSnapshot {
	record: SessionRecord;
	messages: readonly ChatMessage[];
}

export interface ElicitationChoice {
	value: string;
	label: string;
	description?: string;
}

export type ElicitationField =
	| {
			name: string;
			type: "text";
			label: string;
			description?: string;
			required?: boolean;
			placeholder?: string;
			defaultValue?: string;
			secret?: boolean;
			multiline?: boolean;
	  }
	| {
			name: string;
			type: "select";
			label: string;
			description?: string;
			required?: boolean;
			defaultValue?: string;
			options: ElicitationChoice[];
	  }
	| {
			name: string;
			type: "multiSelect";
			label: string;
			description?: string;
			required?: boolean;
			defaultValue?: string[];
			options: ElicitationChoice[];
			min?: number;
			max?: number;
	  }
	| {
			name: string;
			type: "boolean";
			label: string;
			description?: string;
			defaultValue?: boolean;
	  }
	| {
			name: string;
			type: "number";
			label: string;
			description?: string;
			required?: boolean;
			defaultValue?: number;
			integer?: boolean;
			min?: number;
			max?: number;
	  };

export interface ElicitationFormRequest {
	kind: "form";
	id: string;
	sessionId?: SessionId;
	toolCallId?: ToolCallId;
	message: string;
	title?: string;
	fields: ElicitationField[];
}

export interface ElicitationUrlRequest {
	kind: "url";
	id: string;
	sessionId?: SessionId;
	message: string;
	url: string;
}

export type ElicitationRequest = ElicitationFormRequest | ElicitationUrlRequest;

export type ElicitationValue = string | number | boolean | string[];

export interface ElicitationResponse {
	id: string;
	outcome: "accepted" | "declined" | "cancelled";
	values?: Record<string, ElicitationValue>;
}

export type ElicitationPush =
	| { type: "request"; request: ElicitationRequest }
	| { type: "cancel"; id: string };

export type PermissionOptionKind = "allowOnce" | "allowAlways" | "rejectOnce" | "rejectAlways";

export interface PermissionOption {
	id: string;
	name: string;
	kind: PermissionOptionKind;
}

export interface PermissionRequest {
	id: string;
	sessionId: SessionId;
	toolCallId: ToolCallId;
	call: ToolCallBlock;
	options: PermissionOption[];
}

export type PermissionDecision =
	| { id: string; outcome: "selected"; optionId: string }
	| { id: string; outcome: "cancelled" };

export type PermissionPush =
	| { type: "request"; request: PermissionRequest }
	| { type: "cancel"; id: string };

export interface AskUserQuestionOption {
	label: string;
	description: string;
	preview?: string;
	recommendedReason?: string;
}

export interface AskUserQuestionItem {
	question: string;
	header: string;
	options: AskUserQuestionOption[];
	multiSelect?: boolean;
}

export interface AskUserQuestionArgs {
	questions: AskUserQuestionItem[];
}

export interface AskUserQuestionAnswer {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "multi";
	answer: string | null;
	selected?: string[];
	notes?: string;
	preview?: string;
}

export interface AskUserQuestionResult {
	answers: AskUserQuestionAnswer[];
	cancelled: boolean;
}
