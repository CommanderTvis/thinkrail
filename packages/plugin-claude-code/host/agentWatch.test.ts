import { describe, expect, test } from "bun:test";
import { type AgentWatchTarget, createAgentWatch } from "./agentWatch";
import { type ProcessRow, snapshotFromRows } from "./processTree";

interface Harness {
	targets: AgentWatchTarget[];
	rows: ProcessRow[];
	changed: string[];
	cleared: [string, string][];
	timers: number;
	tick: () => void;
}

function harness() {
	const state: Harness = {
		targets: [],
		rows: [],
		changed: [],
		cleared: [],
		timers: 0,
		tick: () => {},
	};
	const watch = createAgentWatch({
		listTargets: () => state.targets,
		onWorkspaceChanged: (id) => state.changed.push(id),
		onAgentCleared: (workspaceId, tabKey) => state.cleared.push([workspaceId, tabKey]),
		capture: () => snapshotFromRows(state.rows),
		schedule: (fn) => {
			state.timers += 1;
			state.tick = fn;
			return 1 as unknown as ReturnType<typeof setInterval>;
		},
		cancel: () => {
			state.timers -= 1;
		},
	});
	return { state, watch };
}

const shellWithClaude = (shellPid: number): ProcessRow[] => [
	{ pid: shellPid, ppid: 1, name: "zsh" },
	{ pid: shellPid + 1, ppid: shellPid, name: "claude" },
];

describe("agent watch", () => {
	test("detects an agent and reports its workspace exactly once", () => {
		const { state, watch } = harness();
		state.targets = [{ workspaceId: "ws", tabKey: "t1", pid: 100 }];
		state.rows = shellWithClaude(100);

		watch.poke();
		state.tick();

		expect(watch.agentFor("ws", "t1")).toBe("claude");
		expect(state.changed).toEqual(["ws"]);
	});

	test("a steady state produces no further notifications", () => {
		const { state, watch } = harness();
		state.targets = [{ workspaceId: "ws", tabKey: "t1", pid: 100 }];
		state.rows = shellWithClaude(100);

		watch.poke();
		state.tick();
		state.changed = [];
		state.tick();
		state.tick();

		expect(state.changed).toEqual([]);
		expect(watch.agentFor("ws", "t1")).toBe("claude");
	});

	test("notifies when the agent exits", () => {
		const { state, watch } = harness();
		state.targets = [{ workspaceId: "ws", tabKey: "t1", pid: 100 }];
		state.rows = shellWithClaude(100);
		watch.poke();
		state.tick();
		state.changed = [];

		state.rows = [{ pid: 100, ppid: 1, name: "zsh" }];
		state.tick();

		expect(watch.agentFor("ws", "t1")).toBeUndefined();
		expect(state.changed).toEqual(["ws"]);
		expect(state.cleared).toEqual([["ws", "t1"]]);
	});

	test("a closed tab drops its agent and notifies its workspace, but is not an onAgentCleared", () => {
		const { state, watch } = harness();
		state.targets = [{ workspaceId: "ws", tabKey: "t1", pid: 100 }];
		state.rows = shellWithClaude(100);
		watch.poke();
		state.tick();
		state.changed = [];

		state.targets = [];
		state.tick();

		expect(watch.agentFor("ws", "t1")).toBeUndefined();
		expect(state.changed).toEqual(["ws"]);
		expect(state.cleared).toEqual([]);
	});

	test("the timer stops when no terminals remain and restarts on the next poke", () => {
		const { state, watch } = harness();
		state.targets = [{ workspaceId: "ws", tabKey: "t1", pid: 100 }];
		state.rows = shellWithClaude(100);

		watch.poke();
		state.tick();
		expect(state.timers).toBe(1);

		state.targets = [];
		state.tick();
		expect(state.timers).toBe(0);

		state.targets = [{ workspaceId: "ws", tabKey: "t2", pid: 200 }];
		state.rows = shellWithClaude(200);
		watch.poke();
		state.tick();
		expect(state.timers).toBe(1);
		expect(watch.agentFor("ws", "t2")).toBe("claude");
	});

	test("poking repeatedly never stacks a second timer", () => {
		const { state, watch } = harness();
		state.targets = [{ workspaceId: "ws", tabKey: "t1", pid: 100 }];
		state.rows = shellWithClaude(100);

		watch.poke();
		watch.poke();
		watch.poke();
		state.tick();

		expect(state.timers).toBe(1);
	});

	test("tracks tabs in separate workspaces independently", () => {
		const { state, watch } = harness();
		state.targets = [
			{ workspaceId: "a", tabKey: "t1", pid: 100 },
			{ workspaceId: "b", tabKey: "t1", pid: 200 },
		];
		state.rows = [...shellWithClaude(100), { pid: 200, ppid: 1, name: "zsh" }];

		watch.poke();
		state.tick();

		expect(watch.agentFor("a", "t1")).toBe("claude");
		expect(watch.agentFor("b", "t1")).toBeUndefined();
		expect(state.changed).toEqual(["a"]);
	});

	test("an unreadable process table leaves the last known state alone", () => {
		const { state } = harness();
		state.targets = [{ workspaceId: "ws", tabKey: "t1", pid: 100 }];
		const watch = createAgentWatch({
			listTargets: () => state.targets,
			onWorkspaceChanged: (id) => state.changed.push(id),
			capture: () => null,
			schedule: (fn) => {
				state.tick = fn;
				return 1 as unknown as ReturnType<typeof setInterval>;
			},
			cancel: () => {},
		});

		watch.poke();
		state.tick();

		expect(watch.agentFor("ws", "t1")).toBeUndefined();
		expect(state.changed).toEqual([]);
	});

	test("stop clears state and the timer", () => {
		const { state, watch } = harness();
		state.targets = [{ workspaceId: "ws", tabKey: "t1", pid: 100 }];
		state.rows = shellWithClaude(100);
		watch.poke();
		state.tick();

		watch.stop();

		expect(state.timers).toBe(0);
		expect(watch.agentFor("ws", "t1")).toBeUndefined();
	});
});
