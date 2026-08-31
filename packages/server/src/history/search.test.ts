import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	openFixtureStore,
	writeFixtureTranscript,
} from "@thinkrail/server/transcript-test-fixtures";
import { makeSnippet, matchesTerms, searchHistory } from "./search";

const includeAll = () => true;
const noProject = () => undefined;

describe("searchHistory", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "thinkrail-history-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("AND-matches every term and orders hits by recency across sessions", async () => {
		await writeFixtureTranscript(dir, {
			sessionId: "sess-a",
			workspaceId: "ws-a",
			cwd: "/repo/a",
			messages: [
				{ role: "user", text: "deploy the frontend service", timestamp: 1000 },
				{ role: "assistant", text: "the frontend service deployed cleanly", timestamp: 3000 },
			],
		});
		await writeFixtureTranscript(dir, {
			sessionId: "sess-b",
			workspaceId: "ws-b",
			cwd: "/repo/b",
			messages: [
				{ role: "user", text: "deploy the backend service", timestamp: 2000 },
				{ role: "user", text: "unrelated note about lunch", timestamp: 4000 },
			],
		});

		const store = openFixtureStore(dir);
		await store.readCorpus();
		const result = await searchHistory(
			{ query: "deploy service", includes: includeAll, projectOf: noProject },
			store,
		);

		expect(result.messages.map((hit) => hit.sessionId)).toEqual(["sess-a"]);
		expect(result.messages.map((hit) => hit.timestamp)).toEqual([3000]);
		expect(result.prompts.map((hit) => hit.sessionId)).toEqual(["sess-b", "sess-a"]);
		expect(result.prompts.map((hit) => hit.timestamp)).toEqual([2000, 1000]);
		expect(result.indexing).toBe(false);
	});

	test("a hit carries the corpus entry's messageId, not a position", async () => {
		await writeFixtureTranscript(dir, {
			sessionId: "sess-a",
			workspaceId: "ws-a",
			cwd: "/repo/a",
			messages: [
				{ role: "user", text: "first widget prompt", timestamp: 1000 },
				{ role: "assistant", text: "widget answer", timestamp: 2000 },
				{ role: "user", text: "second widget prompt", id: "own-id", timestamp: 3000 },
			],
		});

		const result = await searchHistory(
			{ query: "widget", includes: includeAll, projectOf: noProject },
			openFixtureStore(dir),
		);

		expect(result.prompts.map((hit) => hit.messageId)).toEqual(["own-id", "sess-a-m0"]);
		expect(result.messages.map((hit) => hit.messageId)).toEqual(["sess-a-m1"]);
	});

	test("dedups prompts by normalized text, keeping the newest", async () => {
		await writeFixtureTranscript(dir, {
			sessionId: "sess-a",
			workspaceId: "ws-a",
			cwd: "/repo/a",
			messages: [{ role: "user", text: "fix   the bug", timestamp: 1000 }],
		});
		await writeFixtureTranscript(dir, {
			sessionId: "sess-b",
			workspaceId: "ws-b",
			cwd: "/repo/b",
			messages: [{ role: "user", text: "fix the bug", timestamp: 5000 }],
		});

		const result = await searchHistory(
			{ query: "fix bug", includes: includeAll, projectOf: noProject },
			openFixtureStore(dir),
		);

		expect(result.prompts).toHaveLength(1);
		expect(result.prompts[0]?.sessionId).toBe("sess-b");
		expect(result.promptTotal).toBe(1);
	});

	test("the scope callback drops the sessions it excludes, totals included", async () => {
		await writeFixtureTranscript(dir, {
			sessionId: "sess-a",
			workspaceId: "ws-a",
			cwd: "/repo/a",
			messages: [{ role: "user", text: "alpha message about widgets", timestamp: 1000 }],
		});
		await writeFixtureTranscript(dir, {
			sessionId: "sess-b",
			workspaceId: "ws-b",
			cwd: "/repo/b",
			messages: [{ role: "user", text: "beta message about widgets", timestamp: 2000 }],
		});

		const result = await searchHistory(
			{
				query: "widgets",
				includes: (session) => session.workspaceId === "ws-a",
				projectOf: noProject,
			},
			openFixtureStore(dir),
		);

		expect(result.prompts.map((hit) => hit.sessionId)).toEqual(["sess-a"]);
		expect(result.promptTotal).toBe(1);
	});

	test("an empty query returns recent prompts but zero messages", async () => {
		await writeFixtureTranscript(dir, {
			sessionId: "sess-a",
			workspaceId: "ws-a",
			cwd: "/repo/a",
			messages: [
				{ role: "user", text: "hello there", timestamp: 1000 },
				{ role: "assistant", text: "hi, how can I help", timestamp: 2000 },
			],
		});

		const result = await searchHistory(
			{ query: "", includes: includeAll, projectOf: noProject },
			openFixtureStore(dir),
		);

		expect(result.messages).toEqual([]);
		expect(result.messageTotal).toBe(0);
		expect(result.prompts.map((hit) => hit.text)).toEqual(["hello there"]);
		expect(result.promptTotal).toBe(1);
	});

	test("totals are pre-cap counts per section", async () => {
		await writeFixtureTranscript(dir, {
			sessionId: "sess-a",
			workspaceId: "ws-a",
			cwd: "/repo/a",
			messages: [
				{ role: "user", text: "widget one", timestamp: 1000 },
				{ role: "user", text: "widget two", timestamp: 2000 },
				{ role: "user", text: "widget three", timestamp: 3000 },
				{ role: "assistant", text: "widget four report", timestamp: 4000 },
				{ role: "assistant", text: "widget five report", timestamp: 5000 },
				{ role: "assistant", text: "widget six report", timestamp: 6000 },
			],
		});

		const result = await searchHistory(
			{ query: "widget", limit: 2, includes: includeAll, projectOf: noProject },
			openFixtureStore(dir),
		);

		expect(result.prompts.map((hit) => hit.timestamp)).toEqual([3000, 2000]);
		expect(result.promptTotal).toBe(3);
		expect(result.messages.map((hit) => hit.timestamp)).toEqual([6000, 5000]);
		expect(result.messageTotal).toBe(3);
	});

	test("an assistant match carries full text plus a snippet; a user match stays a prompt", async () => {
		const answer = `intro ${"padding ".repeat(40)}needle-marker ${"more-padding ".repeat(40)}end`;
		const prompt = `${"x".repeat(150)} needle-marker ${"y".repeat(150)}`;
		await writeFixtureTranscript(dir, {
			sessionId: "sess-a",
			workspaceId: "ws-a",
			cwd: "/repo/a",
			messages: [
				{ role: "user", text: prompt, timestamp: 1000 },
				{ role: "assistant", text: answer, timestamp: 2000 },
			],
		});

		const result = await searchHistory(
			{ query: "needle-marker", includes: includeAll, projectOf: noProject },
			openFixtureStore(dir),
		);

		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]?.role).toBe("assistant");
		expect(result.messages[0]?.text).toBe(answer);
		expect(result.messages[0]?.anchorText).toBe(answer.slice(0, 120));
		expect(result.messages[0]?.snippet).toContain("needle-marker");
		expect(result.messages[0]?.snippet.length).toBeLessThan(answer.length);
		expect(result.prompts).toHaveLength(1);
		expect(result.prompts[0]?.anchorText).toBe(prompt.slice(0, 120));
	});

	test("a prompt far beyond 4k chars round-trips in full and its tail is searchable", async () => {
		const big = `${"log-line ".repeat(1000)}rare-tail-needle`;
		await writeFixtureTranscript(dir, {
			sessionId: "sess-a",
			workspaceId: "ws-a",
			cwd: "/repo/a",
			messages: [{ role: "user", text: big, timestamp: 1000 }],
		});

		const result = await searchHistory(
			{ query: "rare-tail-needle", includes: includeAll, projectOf: noProject },
			openFixtureStore(dir),
		);

		expect(result.prompts[0]?.text).toBe(big);
	});

	test("workspace and title come from the transcript, the project from the callback", async () => {
		await writeFixtureTranscript(dir, {
			sessionId: "sess-a",
			workspaceId: "ws-a",
			cwd: "/repo/a",
			title: "My chat",
			messages: [{ role: "user", text: "labelled prompt", timestamp: 1000 }],
		});

		const result = await searchHistory(
			{ query: "labelled", includes: includeAll, projectOf: () => "proj-1" },
			openFixtureStore(dir),
		);

		expect(result.prompts[0]).toMatchObject({
			cwd: "/repo/a",
			projectId: "proj-1",
			sessionTitle: "My chat",
			workspaceId: "ws-a",
		});
	});
});

describe("matchesTerms", () => {
	test("requires every term as a case-insensitive substring", () => {
		expect(matchesTerms("Fix the Bug", ["fix", "bug"])).toBe(true);
		expect(matchesTerms("fix the bug", ["fix", "typo"])).toBe(false);
	});

	test("an empty term is vacuously true (empty-query semantics)", () => {
		expect(matchesTerms("anything at all", [""])).toBe(true);
	});
});

describe("makeSnippet", () => {
	test("windows around the first case-insensitive match", () => {
		expect(makeSnippet("aaa NEEDLE bbb", "needle")).toBe("aaa NEEDLE bbb");
	});

	test("truncates with ellipses when the match is far from either edge", () => {
		const text = `${"a".repeat(200)} needle ${"b".repeat(200)}`;
		const snippet = makeSnippet(text, "needle", 10);
		expect(snippet).toContain("needle");
		expect(snippet.startsWith("…")).toBe(true);
		expect(snippet.endsWith("…")).toBe(true);
		expect(snippet.length).toBeLessThan(text.length);
	});
});
