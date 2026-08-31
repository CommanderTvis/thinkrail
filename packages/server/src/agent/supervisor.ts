import type {
	AcpClientDelegates,
	AgentConnection,
	AgentExit,
	ProcessSpawner,
} from "@thinkrail/acp";
import { connectAgent } from "@thinkrail/acp";
import type { AgentStatus, ChatCapabilities } from "@thinkrail/contracts";
import type { AgentStatusSink, ResolvedAgent, SessionClock } from "./ports";

export interface RestartPolicy {
	maxAttempts: number;
	delayMs(attempt: number): number;
}

export const DEFAULT_RESTART_POLICY: RestartPolicy = {
	maxAttempts: 3,
	delayMs: (attempt) => Math.min(8_000, 500 * 2 ** (attempt - 1)),
};

export interface AgentSupervisorOptions {
	delegates: AcpClientDelegates;
	clock: SessionClock;
	onStatus: AgentStatusSink;
	hasSessions(agentId: string): boolean;
	spawn?: ProcessSpawner;
	restart?: RestartPolicy;
	sleep?(ms: number): Promise<void>;
}

interface SupervisedAgent {
	readonly resolved: ResolvedAgent;
	connection: AgentConnection | null;
	connecting: Promise<AgentConnection> | null;
	capabilities: ChatCapabilities | null;
	status: AgentStatus;
	restarts: number;
	closing: boolean;
}

function sleepFor(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		timer.unref?.();
	});
}

export function describeExit(exit: AgentExit): string {
	const how =
		exit.signal !== null
			? `The agent was killed by ${exit.signal}.`
			: exit.code !== null
				? `The agent exited with code ${exit.code}.`
				: "The agent exited.";
	const tail = exit.stderrTail.length > 0 ? exit.stderrTail : exit.stdoutNoise;
	return tail.length > 0 ? `${how}\n${tail}` : how;
}

function describeFailure(error: unknown): string {
	if (error instanceof Error && error.message.length > 0) return error.message;
	return "The agent could not be started.";
}

export class AgentSupervisor {
	readonly #agents = new Map<string, SupervisedAgent>();
	readonly #options: AgentSupervisorOptions;
	readonly #restart: RestartPolicy;
	readonly #sleep: (ms: number) => Promise<void>;

	constructor(options: AgentSupervisorOptions) {
		this.#options = options;
		this.#restart = options.restart ?? DEFAULT_RESTART_POLICY;
		this.#sleep = options.sleep ?? sleepFor;
	}

	async ensure(resolved: ResolvedAgent): Promise<AgentConnection> {
		const id = resolved.descriptor.id;
		const held = this.#agents.get(id);
		if (held !== undefined) {
			if (held.connection !== null && !held.connection.signal.aborted) return held.connection;
			if (held.connecting !== null) return await held.connecting;
			held.restarts = 0;
			held.closing = false;
			return await this.#connect(held);
		}
		const created: SupervisedAgent = {
			resolved,
			connection: null,
			connecting: null,
			capabilities: null,
			status: { phase: "spawning" },
			restarts: 0,
			closing: false,
		};
		this.#agents.set(id, created);
		return await this.#connect(created);
	}

	async restartWithEnv(
		resolved: ResolvedAgent,
		env: Record<string, string>,
	): Promise<AgentConnection> {
		const id = resolved.descriptor.id;
		const held = this.#agents.get(id);
		if (held !== undefined) {
			held.closing = true;
			this.#agents.delete(id);
			if (held.connection !== null) await held.connection.close();
			else if (held.connecting !== null) await held.connecting.catch(() => undefined);
		}
		const merged: ResolvedAgent = {
			...resolved,
			launch: { ...resolved.launch, env: { ...resolved.launch.env, ...env } },
		};
		return await this.ensure(merged);
	}

	connectionFor(agentId: string): AgentConnection | undefined {
		const held = this.#agents.get(agentId);
		if (held?.connection == null || held.connection.signal.aborted) return undefined;
		return held.connection;
	}

	capabilitiesFor(agentId: string): ChatCapabilities | undefined {
		return this.#agents.get(agentId)?.capabilities ?? undefined;
	}

	statusFor(agentId: string): AgentStatus | undefined {
		return this.#agents.get(agentId)?.status;
	}

	async closeAll(): Promise<void> {
		const closing: Promise<unknown>[] = [];
		for (const agent of this.#agents.values()) {
			agent.closing = true;
			if (agent.connection !== null) closing.push(agent.connection.close());
		}
		await Promise.allSettled(closing);
		this.#agents.clear();
	}

	#connect(agent: SupervisedAgent): Promise<AgentConnection> {
		this.#publish(agent, { phase: "spawning" });
		const profile = agent.resolved.profile;
		const spawn = this.#options.spawn;
		const attempt = connectAgent({
			agent: agent.resolved.descriptor,
			launch: agent.resolved.launch,
			delegates: this.#options.delegates,
			clock: this.#options.clock,
			...(profile === undefined ? {} : { profile }),
			...(spawn === undefined ? {} : { spawn }),
			onCapabilities: (capabilities) => {
				agent.capabilities = capabilities;
			},
			onExit: (exit) => {
				void this.#reap(agent, exit);
			},
		}).then(
			(connection) => {
				agent.connecting = null;
				agent.connection = connection;
				agent.capabilities = connection.capabilities;
				this.#publish(agent, { phase: "ready" });
				return connection;
			},
			(error: unknown) => {
				agent.connecting = null;
				agent.connection = null;
				this.#publish(agent, { phase: "unavailable", error: describeFailure(error) });
				throw error;
			},
		);
		agent.connecting = attempt;
		return attempt;
	}

	async #reap(agent: SupervisedAgent, exit: AgentExit): Promise<void> {
		agent.connection = null;
		if (agent.closing) return;
		const willRestart =
			this.#options.hasSessions(agent.resolved.descriptor.id) &&
			agent.restarts < this.#restart.maxAttempts;
		this.#publish(agent, {
			phase: "crashed",
			error: describeExit(exit),
			exitCode: exit.code,
			willRestart,
		});
		if (!willRestart) return;
		agent.restarts += 1;
		this.#publish(agent, { phase: "restarting", attempt: agent.restarts });
		await this.#sleep(this.#restart.delayMs(agent.restarts));
		if (agent.closing) return;
		await this.#connect(agent).catch(() => undefined);
	}

	#publish(agent: SupervisedAgent, status: AgentStatus): void {
		agent.status = status;
		this.#options.onStatus(agent.resolved.descriptor.id, status);
	}
}
