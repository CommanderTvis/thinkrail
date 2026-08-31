import type { EngineSettlement } from "../engine";
import { SessionTranslator } from "./updates";

export interface SessionState {
	readonly sessionId: string;
	readonly cwd: string;
	readonly translator: SessionTranslator;
}

type Waiter = (settlement: EngineSettlement | null) => void;

const CLOSED: EngineSettlement = { stopReason: "aborted" };

export class SessionRegistry {
	private readonly states = new Map<string, SessionState>();
	private readonly directories = new Map<string, string>();
	private readonly waiters = new Map<string, Waiter[]>();

	open(sessionId: string, cwd: string): SessionState {
		this.note(sessionId, cwd);
		const existing = this.states.get(sessionId);
		if (existing) return existing;
		const state: SessionState = {
			sessionId,
			cwd,
			translator: new SessionTranslator(sessionId),
		};
		this.states.set(sessionId, state);
		return state;
	}

	note(sessionId: string, cwd: string): void {
		this.directories.set(sessionId, cwd);
	}

	get(sessionId: string): SessionState | undefined {
		return this.states.get(sessionId);
	}

	cwdOf(sessionId: string): string | undefined {
		return this.directories.get(sessionId);
	}

	drop(sessionId: string): void {
		this.settle(sessionId, CLOSED);
		this.states.delete(sessionId);
		this.directories.delete(sessionId);
	}

	settled(sessionId: string): Promise<EngineSettlement | null> {
		return new Promise((resolve) => {
			const list = this.waiters.get(sessionId) ?? [];
			list.push(resolve);
			this.waiters.set(sessionId, list);
		});
	}

	settle(sessionId: string, settlement: EngineSettlement | null): void {
		const list = this.waiters.get(sessionId);
		if (list === undefined) return;
		this.waiters.delete(sessionId);
		for (const resolve of list) resolve(settlement);
	}

	clear(): void {
		for (const sessionId of [...this.waiters.keys()]) this.settle(sessionId, CLOSED);
		this.states.clear();
		this.directories.clear();
	}
}
