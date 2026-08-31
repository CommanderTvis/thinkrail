import type {
	ClientConnection,
	InitializeResponse,
	McpServer,
	SessionConfigOption,
	SessionInfo,
} from "@agentclientprotocol/sdk";
import { ClientApp, methods, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type {
	AgentDescriptor,
	ChatCapabilities,
	ChatEvent,
	SessionId,
	SessionRecord,
	TurnSettlement,
} from "@thinkrail/contracts";
import type { CapabilityObservation } from "../capabilities";
import {
	authMethods,
	negotiateCapabilities,
	observeCapabilities,
	THINKRAIL_CLIENT_CAPABILITIES,
	THINKRAIL_CLIENT_INFO,
} from "../capabilities";
import type { AcpClientRuntime } from "../client";
import { registerClientHandlers } from "../client";
import { writeThinkRailMeta } from "../meta";
import {
	asEpochMs,
	settlementFromError,
	settlementFromResponse,
	toAgentProviders,
	toConfigOptions,
	toContentBlocks,
	toSetConfigOptionRequest,
	toSetProviderRequest,
} from "../translate";
import {
	AcpAuthRequiredError,
	AcpConnectionClosedError,
	AcpSpawnError,
	AcpVersionError,
	describeRequestError,
	spawnReason,
} from "./errors";
import { SessionRegistry, systemClock } from "./session";
import { spawnWithBun } from "./spawn";
import { drainToTail, endStdin, filterJsonLines, Tail } from "./stdioFraming";
import type {
	AgentConnection,
	AgentExit,
	ConnectAgentOptions,
	McpServerOffer,
	SessionHandle,
	SpawnedProcess,
} from "./types";

const DEFAULT_HANDSHAKE_MS = 15_000;
const SHUTDOWN_GRACE_MS = 500;
const EXIT_DRAIN_MS = 200;

const TIMED_OUT: unique symbol = Symbol("acp.timeout");

export async function connectAgent(options: ConnectAgentOptions): Promise<AgentConnection> {
	let child: SpawnedProcess;
	try {
		child = (options.spawn ?? spawnWithBun)(options.launch);
	} catch (error) {
		throw new AcpSpawnError(spawnReason(error), options.launch, error);
	}
	const stderrTail = new Tail();
	const stdoutNoise = new Tail();
	const stderrDrained = drainToTail(child.stderr, stderrTail);
	const framed = filterJsonLines(child.stdout, (line) => {
		stdoutNoise.push(`${line}\n`);
	});

	const clock = options.clock ?? systemClock;
	const sessions = new SessionRegistry(clock);

	let record: ChatCapabilities | null = null;
	const widen = (observation: CapabilityObservation): ChatEvent[] => {
		if (record === null) return [];
		const next = observeCapabilities(record, observation);
		if (next === undefined) return [];
		record = next;
		options.onCapabilities?.(next);
		return [{ type: "capabilities", capabilities: next }];
	};

	const observed = (events: readonly ChatEvent[]): ChatEvent[] => {
		const out: ChatEvent[] = [];
		for (const event of events) {
			switch (event.type) {
				case "plan":
					if (event.plan !== null) out.push(...widen({ kind: "plan" }));
					break;
				case "commands":
					if (event.commands.length > 0) out.push(...widen({ kind: "commands" }));
					break;
				case "usage":
					out.push(
						...widen({
							kind: "usage",
							cost: event.usage.cost !== undefined,
							tokens: event.usage.tokens !== undefined,
							context: event.usage.contextUsed !== null || event.usage.contextWindow !== null,
						}),
					);
					break;
				case "config_options":
					out.push(...widen({ kind: "configOptions", options: event.options }));
					break;
				default:
					break;
			}
		}
		return out;
	};

	const publish = (sessionId: SessionId, events: ChatEvent[]): void => {
		if (events.length === 0) return;
		events.push(...observed(events));
		const replay = sessions.get(sessionId)?.replaySink() ?? null;
		if (replay !== null) {
			replay(events);
			return;
		}
		options.delegates.publish(sessionId, events);
	};

	const life = new AbortController();
	const runtime: AcpClientRuntime = {
		// Must stay synchronous through assembly and publish — see SPEC.md.
		applyUpdate(notification) {
			const state = sessions.ensure(notification.sessionId);
			publish(notification.sessionId, state.assembler.apply(notification));
		},
		nextId: () => clock.nextId(),
		signal: life.signal,
	};

	const app = new ClientApp({ name: "thinkrail" });
	registerClientHandlers(app, options.delegates, runtime);
	const acp: ClientConnection = app.connect(ndJsonStream(child.stdin, framed));
	const ctx = acp.agent;

	const exited: Promise<AgentExit> = (async () => {
		const outcome = await child.exited;
		await raceTimeout(stderrDrained, EXIT_DRAIN_MS);
		const exit: AgentExit = {
			code: outcome.code,
			signal: outcome.signal,
			stderrTail: stderrTail.text(),
			stdoutNoise: stdoutNoise.text(),
		};
		options.onExit?.(exit);
		return exit;
	})();

	let shuttingDown = false;
	const shutdown = async (): Promise<AgentExit> => {
		if (!shuttingDown) {
			shuttingDown = true;
			acp.close();
			life.abort();
			endStdin(child.stdin);
			if ((await raceTimeout(child.exited, SHUTDOWN_GRACE_MS)) === TIMED_OUT) {
				child.kill("SIGTERM");
				if ((await raceTimeout(child.exited, SHUTDOWN_GRACE_MS)) === TIMED_OUT) {
					child.kill("SIGKILL");
				}
			}
			sessions.clear();
		}
		return exited;
	};

	void acp.closed
		.catch(() => undefined)
		.then(() => {
			void shutdown();
		});

	const initialize = await handshake(
		ctx,
		options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_MS,
		shutdown,
	);
	if (initialize.protocolVersion !== PROTOCOL_VERSION) {
		const received = initialize.protocolVersion;
		await shutdown();
		throw new AcpVersionError(PROTOCOL_VERSION, received);
	}

	const descriptor = describeAgent(options.agent, initialize);
	const negotiated = negotiateCapabilities({
		agent: descriptor,
		initialize,
		...(options.profile !== undefined ? { profile: options.profile } : {}),
	});
	record = negotiated;
	const advertisedAuthMethods = authMethods(initialize.authMethods);

	const requireProviderConfig = (): void => {
		if (!negotiated.providerConfig) {
			throw new Error(`${descriptor.name} does not support provider configuration.`);
		}
	};

	const call = async <T>(work: () => Promise<T>): Promise<T> => {
		try {
			return await work();
		} catch (error) {
			const info = describeRequestError(error);
			if (info.authRequired) throw new AcpAuthRequiredError(info.message);
			if (acp.signal.aborted) throw new AcpConnectionClosedError(await exited, info.message);
			throw error;
		}
	};

	const openSession = (
		sessionId: SessionId,
		reported: readonly SessionConfigOption[] | null | undefined,
	): SessionHandle => {
		sessions.ensure(sessionId);
		const configOptions = toConfigOptions(reported);
		if (configOptions.length > 0) {
			publish(sessionId, [{ type: "config_options", options: configOptions }]);
		}
		return { sessionId, configOptions };
	};

	const toSessionRecord = (info: SessionInfo): SessionRecord => {
		const updatedAt = asEpochMs(info.updatedAt) ?? clock.now();
		return {
			sessionId: info.sessionId,
			workspaceId: "",
			cwd: info.cwd,
			agentId: descriptor.id,
			title: typeof info.title === "string" && info.title.length > 0 ? info.title : null,
			createdAt: updatedAt,
			updatedAt,
			messageCount: 0,
			promptCount: 0,
			lastSettlement: null,
			usage: null,
			config: [],
		};
	};

	return {
		agent: descriptor,
		get capabilities(): ChatCapabilities {
			return record ?? negotiated;
		},
		signal: life.signal,
		exited,
		authMethods: advertisedAuthMethods,

		async newSession(input) {
			const response = await call(() =>
				ctx.request(methods.agent.session.new, {
					cwd: input.cwd,
					mcpServers: toMcpServers(input.mcpServers),
					...(input.additionalDirectories !== undefined
						? { additionalDirectories: input.additionalDirectories }
						: {}),
				}),
			);
			return openSession(response.sessionId, response.configOptions);
		},

		async loadSession(input) {
			const state = sessions.ensure(input.sessionId);
			const response = await state.divert(input.replay ?? null, () =>
				call(() =>
					ctx.request(methods.agent.session.load, {
						sessionId: input.sessionId,
						cwd: input.cwd,
						mcpServers: toMcpServers(input.mcpServers),
						...(input.additionalDirectories !== undefined
							? { additionalDirectories: input.additionalDirectories }
							: {}),
					}),
				),
			);
			return openSession(input.sessionId, response.configOptions);
		},

		async listSessions(cwd) {
			const response = await call(() =>
				ctx.request(methods.agent.session.list, cwd !== undefined ? { cwd } : {}),
			);
			return response.sessions.map(toSessionRecord);
		},

		async deleteSession(sessionId) {
			await call(() => ctx.request(methods.agent.session.delete, { sessionId }));
			sessions.drop(sessionId);
		},

		async closeSession(sessionId) {
			await call(() => ctx.request(methods.agent.session.close, { sessionId }));
			sessions.drop(sessionId);
		},

		async prompt(input) {
			const state = sessions.ensure(input.sessionId);
			const opened = state.assembler.beginTurn(input.content);
			publish(input.sessionId, opened.events);
			let settlement: TurnSettlement;
			try {
				const response = await call(() =>
					ctx.request(methods.agent.session.prompt, {
						sessionId: input.sessionId,
						prompt: toContentBlocks(input.content),
						...(input.steer !== undefined
							? { _meta: writeThinkRailMeta({ steer: { mode: input.steer } }) }
							: {}),
					}),
				);
				state.addTurnTokens(response.usage);
				settlement = settlementFromResponse(response);
			} catch (error) {
				settlement = settlementFromError(error);
			}
			publish(input.sessionId, state.assembler.settle(settlement));
			return { messageId: opened.messageId, settlement };
		},

		async cancel(sessionId) {
			await ctx.notify(methods.agent.session.cancel, { sessionId });
		},

		async setConfigOption(input) {
			const response = await call(() =>
				ctx.request(methods.agent.session.setConfigOption, toSetConfigOptionRequest(input)),
			);
			const configOptions = toConfigOptions(response.configOptions);
			publish(input.sessionId, [{ type: "config_options", options: configOptions }]);
			return configOptions;
		},

		async authenticate(methodId, value) {
			const params = { methodId, ...(value !== undefined ? { value } : {}) };
			await call(() => ctx.request(methods.agent.authenticate, params));
		},

		async logout(methodId) {
			const params = methodId !== undefined ? { methodId } : {};
			await call(() => ctx.request(methods.agent.logout, params));
		},

		async listProviders() {
			if (!negotiated.providerConfig) return [];
			const response = await call(() => ctx.request(methods.agent.providers.list, {}));
			return toAgentProviders(response.providers);
		},

		async setProvider(routing) {
			requireProviderConfig();
			await call(() => ctx.request(methods.agent.providers.set, toSetProviderRequest(routing)));
		},

		async disableProvider(providerId) {
			requireProviderConfig();
			await call(() => ctx.request(methods.agent.providers.disable, { providerId }));
		},

		async ext<R>(method: string, params: Record<string, unknown>) {
			return await call(() => ctx.request<R, Record<string, unknown>>(method, params));
		},

		close: shutdown,
	};
}

async function handshake(
	ctx: ClientConnection["agent"],
	timeoutMs: number,
	shutdown: () => Promise<AgentExit>,
): Promise<InitializeResponse> {
	const attempt = await raceTimeout(
		ctx
			.request(methods.agent.initialize, {
				protocolVersion: PROTOCOL_VERSION,
				clientCapabilities: THINKRAIL_CLIENT_CAPABILITIES,
				clientInfo: THINKRAIL_CLIENT_INFO,
			})
			.then(
				(response) => ({ ok: true, response }) as const,
				(error: unknown) => ({ ok: false, error }) as const,
			),
		timeoutMs,
	);
	if (attempt === TIMED_OUT) {
		const exit = await shutdown();
		throw new AcpConnectionClosedError(
			exit,
			`the agent did not answer initialize within ${timeoutMs}ms`,
		);
	}
	if (!attempt.ok) {
		const exit = await shutdown();
		throw new AcpConnectionClosedError(exit, describeRequestError(attempt.error).message);
	}
	return attempt.response;
}

function describeAgent(agent: AgentDescriptor, initialize: InitializeResponse): AgentDescriptor {
	const reported = initialize.agentInfo?.version;
	const version = typeof reported === "string" && reported.length > 0 ? reported : undefined;
	return {
		...agent,
		protocolVersion: initialize.protocolVersion,
		...(agent.version === undefined && version !== undefined ? { version } : {}),
	};
}

function toMcpServers(offers: readonly McpServerOffer[] | undefined): McpServer[] {
	const out: McpServer[] = [];
	for (const offer of offers ?? []) {
		if (offer.kind === "acp") {
			out.push({ type: "acp", name: offer.name, serverId: offer.serverId });
			continue;
		}
		out.push({ type: "http", name: offer.name, url: offer.url, headers: offer.headers ?? [] });
	}
	return out;
}

async function raceTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
	void work.catch(() => undefined);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<typeof TIMED_OUT>((resolve) => {
				timer = setTimeout(() => {
					resolve(TIMED_OUT);
				}, ms);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
