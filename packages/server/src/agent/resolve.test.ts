import { expect, test } from "bun:test";
import type { AgentCatalogEntry } from "@thinkrail/acp";
import type { AppConfig, Project } from "@thinkrail/contracts";
import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import {
	type AgentCandidates,
	bundledAgent,
	describeAgent,
	dormantCapabilities,
	listAgents,
	preferredAgentId,
	resolveAgent,
	UnknownAgentError,
} from "./resolve";

const BUNDLED = bundledAgent({ command: "thinkrail", args: ["acp-pi"] });

const JUNIE: AgentCatalogEntry = {
	id: "junie",
	name: "Junie",
	version: "1.2.3",
	origin: "installed",
	launch: { command: "/agents/junie/junie", args: ["--acp=true"] },
};

function candidates(installed: AgentCatalogEntry[] = [JUNIE]): AgentCandidates {
	return { bundled: BUNDLED, installed };
}

function project(agentId?: string): Project {
	return {
		id: "p1",
		name: "repo",
		path: "/repo",
		slug: "repo",
		lastOpened: 0,
		...(agentId === undefined ? {} : { agentId }),
	};
}

function config(defaultAgentId: string | null): AppConfig {
	return { ...DEFAULT_CONFIG, defaultAgentId };
}

test("the project override beats the global default, which beats the bundled agent", () => {
	expect(preferredAgentId(project("junie"), config("other"))).toBe("junie");
	expect(preferredAgentId(project(), config("other"))).toBe("other");
	expect(preferredAgentId(undefined, config(null))).toBeNull();
	expect(resolveAgent(null, candidates()).descriptor.id).toBe(BUNDLED.descriptor.id);
});

test("an installed id resolves to its recorded launch spec and registry profile", () => {
	const resolved = resolveAgent("junie", candidates());
	expect(resolved.descriptor).toEqual({
		id: "junie",
		name: "Junie",
		origin: "installed",
		version: "1.2.3",
	});
	expect(resolved.launch.args).toEqual(["--acp=true"]);
	expect(resolved.profile?.id).toBe("junie");
});

test("an id that is no longer installed fails at the point of use, naming itself", () => {
	const failure = (): unknown => resolveAgent("junie", candidates([]));
	expect(failure).toThrow(UnknownAgentError);
	try {
		failure();
	} catch (error) {
		expect((error as UnknownAgentError).agentId).toBe("junie");
	}
});

test("the bundled agent leads the list and is never duplicated by a catalog row", () => {
	const stale: AgentCatalogEntry = {
		id: BUNDLED.descriptor.id,
		name: "stale copy",
		origin: "installed",
		launch: { command: "nope", args: [] },
	};
	const listed = listAgents(candidates([stale, JUNIE]));
	expect(listed.map((agent) => agent.id)).toEqual([BUNDLED.descriptor.id, "junie"]);
	expect(listed[0]?.origin).toBe("bundled");
	expect(listed[0]?.command).toBe("thinkrail");
});

test("a transcript naming an agent nobody has still describes itself", () => {
	const agents = listAgents(candidates());
	expect(describeAgent("junie", agents).name).toBe("Junie");
	expect(describeAgent("ghost", agents)).toEqual({
		id: "ghost",
		name: "ghost",
		origin: "external",
	});
});

test("a chat whose agent is not running offers nothing rather than something broken", () => {
	const capabilities = dormantCapabilities(BUNDLED.descriptor);
	expect(capabilities.steering).toBe("none");
	expect(capabilities.plan).toBe("none");
	expect(capabilities.mcpTools).toBe("none");
	expect(capabilities.sessionLoad).toBe(false);
	expect(capabilities.agent).toBe(BUNDLED.descriptor);
	expect(capabilities.derivedFrom.permissions).toBe("host");
});
