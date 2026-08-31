import { expect, test } from "bun:test";
import type { Project, TranscriptCorpusSession, Workspace } from "@thinkrail/contracts";
import { buildHistoryScope } from "./historyScope";

const p1: Project = { id: "p1", name: "one", path: "/proj1", slug: "one", lastOpened: 0 };
const p2: Project = { id: "p2", name: "two", path: "/proj2", slug: "two", lastOpened: 0 };

function workspace(id: string, projectId: string): Workspace {
	return {
		id,
		projectId,
		name: id,
		branch: id,
		worktreePath: `/${projectId}/worktrees/${id}`,
		baseBranch: "main",
	};
}

function session(sessionId: string, workspaceId: string): TranscriptCorpusSession {
	return { sessionId, workspaceId, cwd: `/wt/${workspaceId}`, title: null, entries: [] };
}

const registry = (projectId: string): Workspace[] => {
	if (projectId === "p1") return [workspace("ws1", "p1"), workspace("ws2", "p1")];
	if (projectId === "p2") return [workspace("ws3", "p2")];
	return [];
};

test("all scope includes every session", () => {
	const { includes } = buildHistoryScope({ kind: "all" }, [p1, p2], registry);

	expect(includes(session("s1", "ws1"))).toBe(true);
	expect(includes(session("s2", "ws3"))).toBe(true);
	expect(includes(session("s3", "an-archived-workspace"))).toBe(true);
});

test("chat scope includes only the named chat", () => {
	const { includes } = buildHistoryScope({ kind: "chat", sessionId: "target" }, [p1], registry);

	expect(includes(session("target", "ws1"))).toBe(true);
	expect(includes(session("other", "ws1"))).toBe(false);
});

test("workspace scope includes only that workspace's chats", () => {
	const { includes } = buildHistoryScope({ kind: "workspace", workspaceId: "ws1" }, [p1], registry);

	expect(includes(session("s1", "ws1"))).toBe(true);
	expect(includes(session("s2", "ws2"))).toBe(false);
});

test("an archived workspace still scopes its own chats — the id is matched, not the registry", () => {
	const { includes } = buildHistoryScope(
		{ kind: "workspace", workspaceId: "gone" },
		[p1],
		registry,
	);

	expect(includes(session("s2", "gone"))).toBe(true);
	expect(includes(session("s1", "ws1"))).toBe(false);
});

test("project scope includes every workspace of that project and no other", () => {
	const { includes } = buildHistoryScope({ kind: "project", projectId: "p1" }, [p1, p2], registry);

	expect(includes(session("s1", "ws1"))).toBe(true);
	expect(includes(session("s2", "ws2"))).toBe(true);
	expect(includes(session("s3", "ws3"))).toBe(false);
});

test("projectOf resolves a chat's project through its workspace, and stays undefined for a workspace ThinkRail no longer knows", () => {
	const { projectOf } = buildHistoryScope({ kind: "all" }, [p1, p2], registry);

	expect(projectOf(session("s1", "ws1"))).toBe("p1");
	expect(projectOf(session("s3", "ws3"))).toBe("p2");
	expect(projectOf(session("s4", "archived"))).toBeUndefined();
});
