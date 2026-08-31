import type {
	AgentContext,
	AvailableCommand,
	CreateElicitationRequest,
	CreateElicitationResponse,
	PromptResponse,
	ProviderInfo,
	SessionConfigOption,
	SessionInfo,
	SessionUpdate,
	StopReason,
} from "@agentclientprotocol/sdk";
import { AgentApp, methods, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import type { Provider } from "@earendil-works/pi-ai";
import type { ThinkRailMeta } from "@thinkrail/acp/meta";
import { readThinkRailMeta, THINKRAIL_EXT_METHODS, writeThinkRailMeta } from "@thinkrail/acp/meta";
import type { AskUserQuestionResult } from "@thinkrail/contracts";
import type { EngineEvent, EngineSettlement, ExtUiBridge } from "../engine";
import {
	abortSession,
	clampThinkingForModel,
	compactSession,
	createSession,
	deleteSession,
	disposeAllSessions,
	ensureSessionAttached,
	followUpSession,
	getDefaultModel,
	getSessionCommands,
	getSessionConfig,
	getSessionStats,
	listAvailableModels,
	listSessions,
	promptSession,
	readChildTranscript,
	removeSession,
	setExtUiBridge,
	setQuestionnaireAsk,
	setSessionEventSink,
	setSessionModel,
	setSessionThinkingLevel,
	setSessionToolsProvider,
	usePiRuntime,
} from "../engine";
import {
	type NegotiatedClient,
	OFFLINE_CLIENT,
	PI_AGENT_CAPABILITIES,
	PI_AGENT_EXTENSIONS,
	PI_AGENT_INFO,
	readClientCapabilities,
} from "./capabilities";
import { COMPACT_COMMAND, parseCompactCommand } from "./compactCommand";
import {
	configOptionsFor,
	isThinkingLevel,
	MODEL_OPTION_ID,
	parseModelValueId,
	THINKING_OPTION_ID,
} from "./configOptions";
import { toPiPrompt } from "./content";
import { delegatedToolDefinitions } from "./delegation";
import {
	dialogMessage,
	dialogSchema,
	questionnaireSchema,
	readDialogAnswer,
	readQuestionnaireAnswers,
} from "./elicitation";
import { SessionRegistry } from "./sessions";
import { toStopReason } from "./updates";

export function createPiAgentApp(): AgentApp {
	const sessions = new SessionRegistry();
	let client: AgentContext | null = null;
	let clientCapabilities: NegotiatedClient = OFFLINE_CLIENT;
	let outbound: Promise<void> = Promise.resolve();

	const send = (sessionId: string, update: SessionUpdate, meta?: ThinkRailMeta): void => {
		const target = client;
		if (target === null) return;
		const params = {
			sessionId,
			update,
			...(meta !== undefined ? { _meta: writeThinkRailMeta(meta) } : {}),
		};
		outbound = outbound
			.then(() => target.notify(methods.client.session.update, params))
			.catch(() => undefined);
	};

	setSessionToolsProvider((binding, cwd, settings) =>
		delegatedToolDefinitions(cwd, settings, { client: () => client, binding }, clientCapabilities),
	);

	const elicit = async (
		request: CreateElicitationRequest,
		signal: AbortSignal | undefined,
	): Promise<CreateElicitationResponse | null> => {
		const target = client;
		if (target === null || !clientCapabilities.elicitation) return null;
		try {
			return await target.request(
				methods.client.elicitation.create,
				request,
				signal !== undefined ? { cancellationSignal: signal } : {},
			);
		} catch {
			return null;
		}
	};

	const bridge: ExtUiBridge = {
		async ask(sessionId, dialog, signal) {
			const response = await elicit(
				{
					mode: "form",
					sessionId,
					message: dialogMessage(dialog),
					requestedSchema: dialogSchema(dialog),
				},
				signal,
			);
			return response === null ? null : readDialogAnswer(response);
		},
		notify(sessionId, message) {
			send(sessionId, {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: message },
			});
		},
		setTitle(sessionId, title) {
			send(sessionId, { sessionUpdate: "session_info_update", title });
		},
	};
	setExtUiBridge(bridge);

	setQuestionnaireAsk(
		async (sessionId, toolCallId, args, signal): Promise<AskUserQuestionResult> => {
			const response = await elicit(
				{
					mode: "form",
					sessionId,
					toolCallId,
					message: args.questions[0]?.question ?? "A few questions before I continue.",
					requestedSchema: questionnaireSchema(args),
				},
				signal,
			);
			return response === null
				? { answers: [], cancelled: true }
				: readQuestionnaireAnswers(args, response);
		},
	);

	const optionsFor = async (sessionId: string): Promise<SessionConfigOption[]> => {
		const config = getSessionConfig(sessionId);
		return configOptionsFor(await listAvailableModels(), config.model, config.thinkingLevel);
	};

	const publishConfigOptions = async (sessionId: string): Promise<SessionConfigOption[]> => {
		const options = await optionsFor(sessionId);
		send(sessionId, { sessionUpdate: "config_option_update", configOptions: options });
		return options;
	};

	const publishCommands = (sessionId: string): void => {
		const availableCommands: AvailableCommand[] = [
			{ ...COMPACT_COMMAND, input: { hint: "instructions" } },
			...getSessionCommands(sessionId).map((command) => ({
				name: command.name,
				description: command.description ?? "",
				...(command.argumentHint !== undefined ? { input: { hint: command.argumentHint } } : {}),
			})),
		];
		send(sessionId, { sessionUpdate: "available_commands_update", availableCommands });
	};

	const publishUsage = (sessionId: string): void => {
		const stats = getSessionStats(sessionId);
		const usage = stats.contextUsage;
		if (usage === undefined) return;
		send(sessionId, {
			sessionUpdate: "usage_update",
			used: usage.tokens ?? 0,
			size: usage.contextWindow,
			cost: { amount: stats.cost, currency: "USD" },
		});
	};

	const opened = async (sessionId: string, cwd: string): Promise<SessionConfigOption[]> => {
		sessions.open(sessionId, cwd);
		return optionsFor(sessionId);
	};

	// A push before session/new's response names a session the client has not been told about — see SPEC.
	const announce = (sessionId: string): void => {
		setTimeout(() => {
			if (sessions.get(sessionId) === undefined) return;
			publishCommands(sessionId);
			publishUsage(sessionId);
		}, 0);
	};

	setSessionEventSink((sessionId, event: EngineEvent) => {
		const state = sessions.get(sessionId);
		if (state === undefined) return;
		if (event.type === "agent_settled") {
			sessions.settle(sessionId, event.terminal);
			return;
		}
		if (event.type === "thinking_level_changed") {
			void publishConfigOptions(sessionId);
			return;
		}
		for (const translated of state.translator.translate(event)) {
			send(sessionId, translated.update, translated.meta);
		}
	});

	return new AgentApp({ name: "thinkrail-pi" })
		.onConnect((connection) => {
			client = connection.client;
			void connection.closed.then(() => {
				client = null;
				sessions.clear();
				disposeAllSessions();
			});
		})
		.onRequest(methods.agent.initialize, ({ params }) => {
			clientCapabilities = readClientCapabilities(params.clientCapabilities);
			return {
				protocolVersion: PROTOCOL_VERSION,
				agentCapabilities: PI_AGENT_CAPABILITIES,
				agentInfo: PI_AGENT_INFO,
				_meta: writeThinkRailMeta({ extensions: [...PI_AGENT_EXTENSIONS] }),
			};
		})
		.onRequest(methods.agent.session.new, async ({ params }) => {
			refuseUnsupportedMcpServers(params.mcpServers);
			const fallback = await getDefaultModel();
			const created = await createSession({
				cwd: params.cwd,
				...(fallback.model ? { model: fallback.model } : {}),
				thinkingLevel: fallback.thinkingLevel,
			});
			const configOptions = await opened(created.sessionId, params.cwd);
			announce(created.sessionId);
			return { sessionId: created.sessionId, configOptions };
		})
		.onRequest(methods.agent.session.load, async ({ params }) => {
			refuseUnsupportedMcpServers(params.mcpServers);
			const attached = await ensureSessionAttached(params.sessionId, params.cwd);
			if (!attached) throw RequestError.resourceNotFound(params.sessionId);
			const configOptions = await opened(params.sessionId, params.cwd);
			announce(params.sessionId);
			return { configOptions };
		})
		.onRequest(methods.agent.session.list, async ({ params }) => {
			const cwd = params.cwd;
			if (cwd === undefined || cwd === null) return { sessions: [] };
			const listed = await listSessions(cwd);
			const infos: SessionInfo[] = listed.map((summary) => {
				sessions.note(summary.sessionId, summary.cwd);
				return {
					sessionId: summary.sessionId,
					cwd: summary.cwd,
					title: summary.title,
					updatedAt: new Date(summary.updatedAt).toISOString(),
				};
			});
			return { sessions: infos };
		})
		.onRequest(methods.agent.session.delete, async ({ params }) => {
			const cwd = sessions.cwdOf(params.sessionId);
			if (cwd === undefined) throw RequestError.resourceNotFound(params.sessionId);
			await deleteSession(params.sessionId, cwd);
			sessions.drop(params.sessionId);
			return {};
		})
		.onRequest(methods.agent.session.close, ({ params }) => {
			removeSession(params.sessionId);
			sessions.drop(params.sessionId);
			return {};
		})
		.onRequest(methods.agent.session.setConfigOption, async ({ params }) => {
			if (sessions.get(params.sessionId) === undefined) {
				throw RequestError.resourceNotFound(params.sessionId);
			}
			const value = params.value;
			if (typeof value !== "string") throw RequestError.invalidParams({ value });
			if (params.configId === MODEL_OPTION_ID) {
				const ref = parseModelValueId(value);
				if (ref === undefined) throw RequestError.invalidParams({ value });
				await setSessionModel(params.sessionId, ref);
				const config = getSessionConfig(params.sessionId);
				if (config.model !== null) {
					setSessionThinkingLevel(
						params.sessionId,
						await clampThinkingForModel(config.model, config.thinkingLevel),
					);
				}
			} else if (params.configId === THINKING_OPTION_ID) {
				const model = getSessionConfig(params.sessionId).model;
				if (model === null || !isThinkingLevel(value, model.thinkingLevels)) {
					throw RequestError.invalidParams({ value });
				}
				setSessionThinkingLevel(params.sessionId, await clampThinkingForModel(model, value));
			} else {
				throw RequestError.invalidParams({ configId: params.configId });
			}
			return { configOptions: await publishConfigOptions(params.sessionId) };
		})
		.onRequest(methods.agent.session.prompt, async ({ params }): Promise<PromptResponse> => {
			if (sessions.get(params.sessionId) === undefined) {
				throw RequestError.resourceNotFound(params.sessionId);
			}
			const { text, images } = toPiPrompt(params.prompt);
			const settled = sessions.settled(params.sessionId);
			const compaction = parseCompactCommand(text);
			if (compaction !== null && images.length === 0) {
				await compactSession(params.sessionId, compaction.instructions);
				await outbound;
				return { stopReason: "end_turn" };
			}
			const mode = readThinkRailMeta(params._meta)?.steer?.mode;
			const deliver = mode === "followUp" ? followUpSession : promptSession;
			await deliver(params.sessionId, text, images.length > 0 ? images : undefined);
			const settlement = await settled;
			publishUsage(params.sessionId);
			await outbound;
			return { stopReason: promptStopReason(settlement) };
		})
		.onRequest(
			THINKRAIL_EXT_METHODS.subagentTranscript,
			(raw: unknown) => raw as { cwd: string; parentSessionId: string; childSessionId: string },
			({ params }) =>
				readChildTranscript(params.cwd, params.parentSessionId, params.childSessionId),
		)
		.onNotification(methods.agent.session.cancel, async ({ params }) => {
			try {
				await abortSession(params.sessionId);
			} catch {
				return;
			}
		})
		.onRequest(methods.agent.providers.list, () =>
			usePiRuntime((runtime) => ({ providers: runtime.getProviders().map(providerInfo) })),
		)
		.onRequest(methods.agent.providers.set, async ({ params }) => {
			await usePiRuntime((runtime) => {
				runtime.registerProvider(params.providerId, {
					api: params.apiType,
					baseUrl: params.baseUrl,
					...(params.headers !== undefined ? { headers: params.headers } : {}),
				});
			});
			return {};
		})
		.onRequest(methods.agent.providers.disable, async ({ params }) => {
			await usePiRuntime((runtime) => {
				runtime.unregisterProvider(params.providerId);
			});
			return {};
		});
}

function providerInfo(provider: Provider): ProviderInfo {
	const supported = [...new Set(provider.getModels().map((model) => model.api))];
	return { providerId: provider.id, supported, required: false };
}

function refuseUnsupportedMcpServers(servers: readonly { name: string }[] | undefined): void {
	if (servers === undefined || servers.length === 0) return;
	throw RequestError.invalidParams({
		mcpServers: servers.map((server) => server.name),
		reason: "the bundled pi agent registers ThinkRail's tools natively and has no MCP client",
	});
}

function promptStopReason(settlement: EngineSettlement | null): StopReason {
	if (settlement === null) return "end_turn";
	if (settlement.stopReason === "error") {
		throw RequestError.internalError(
			settlement.errorMessage ?? "the model provider reported an error",
		);
	}
	return toStopReason(settlement.stopReason) ?? "end_turn";
}
