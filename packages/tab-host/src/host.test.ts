import { expect, test } from "bun:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { ServerWelcome, WsServerMessage } from "@thinkrail/contracts";
import { definePluginManifest, PLUGIN_API_GENERATION } from "@thinkrail/plugin-api";
import { createTabFs } from "./fs";
import { TabHost } from "./host";
import { toWireModel } from "./models";

const processOnly = definePluginManifest({
	id: "process-only",
	label: "Process only",
	icon: "terminal",
	version: "1.0.0",
	apiGeneration: PLUGIN_API_GENERATION,
	wireVersion: 1,
	enabledByDefault: true,
	runsInBrowserTab: false,
	dependsOn: [],
	contributes: { sideTools: [], fileViewers: [] },
});

function harness() {
	const faux = fauxProvider();
	const messages: WsServerMessage[] = [];
	const fs = createTabFs();
	const host = new TabHost({
		fs,
		post: (message) => messages.push(message),
		persist: () => undefined,
		plugins: { modules: [], manifests: [processOnly] },
		providers: [faux.provider],
	});
	let seq = 0;
	const request = async (method: string, params: unknown) => {
		const id = `r${++seq}`;
		await host.handle({ id, method, params });
		const reply = messages.find((m) => "id" in m && m.id === id) as {
			ok: boolean;
			result?: unknown;
			error?: string;
		};
		if (!reply.ok) throw new Error(reply.error);
		return reply.result as never;
	};
	const pushes = (channel: string) =>
		messages
			.filter((m) => "channel" in m && m.channel === channel)
			.map((m) => (m as { data: unknown }).data);
	return { faux, fs, host, request, pushes };
}

test("the welcome refuses a plugin that cannot run in a tab", async () => {
	const { host, pushes } = harness();
	await host.start();
	const welcome = pushes("server.welcome")[0] as ServerWelcome;
	expect(welcome.plugins).toEqual([
		expect.objectContaining({
			id: "process-only",
			status: "refused",
			reason: expect.stringContaining("ThinkRail Playground"),
		}),
	]);
});

test("a method the tab host does not serve answers a plain error", async () => {
	const { host, request } = harness();
	await host.start();
	await expect(request("workspace.create", {})).rejects.toThrow(
		"not available in the ThinkRail Playground",
	);
});

test("pi in the tab edits the project and commits it with git", async () => {
	const { faux, fs, host, request, pushes } = harness();
	await host.start();
	const project = (await request("project.create", { parentPath: "/projects", name: "demo" })) as {
		id: string;
		path: string;
	};
	const [workspace] = (await request("workspace.list", { projectId: project.id })) as [
		{ id: string; vcs?: string },
	];
	expect(workspace.vcs).toBe("unborn");

	faux.setResponses([
		fauxAssistantMessage(
			[fauxToolCall("write", { path: "hello.txt", content: "hi from the tab\n" })],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage([fauxToolCall("git_commit", { message: "Add hello.txt" })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxText("Committed.")]),
	]);
	const { sessionId } = (await request("session.create", {
		workspaceId: workspace.id,
		model: toWireModel(faux.getModel()),
		thinkingLevel: "off",
	})) as { sessionId: string };
	await request("session.prompt", { sessionId, text: "add hello.txt and commit it" });
	for (
		let i = 0;
		i < 200 &&
		!pushes("pi.event").some(
			(p) => (p as { event: { type: string } }).event.type === "agent_settled",
		);
		i++
	)
		await new Promise((resolve) => setTimeout(resolve, 10));

	expect(fs.readFileSync(`${project.path}/hello.txt`, "utf8")).toBe("hi from the tab\n");
	const { commits } = (await request("git.listCommits", { workspaceId: workspace.id })) as {
		commits: { subject: string }[];
	};
	expect(commits.map((c) => c.subject)).toEqual(["Add hello.txt"]);
	expect(pushes("workspace.fsChanged")).toContainEqual(
		expect.objectContaining({ workspaceId: workspace.id, truncated: true }),
	);
	const updates = pushes("workspace.updated") as { id: string; vcs?: string }[];
	expect(updates.at(-1)).toEqual(expect.objectContaining({ id: workspace.id }));
	expect(updates.at(-1)?.vcs).toBeUndefined();
	const settled = pushes("pi.event").find(
		(p) => (p as { event: { type: string } }).event.type === "agent_settled",
	);
	expect(settled).toEqual({
		sessionId,
		event: { type: "agent_settled", terminal: { stopReason: "stop" } },
	});
	const { messages } = (await request("session.getMessages", {
		sessionId,
		workspaceId: workspace.id,
	})) as { messages: { role: string }[] };
	expect(messages.map((m) => m.role)).toEqual([
		"user",
		"assistant",
		"toolResult",
		"assistant",
		"toolResult",
		"assistant",
	]);
});

test("a project clones over smart HTTP into the tab filesystem", async () => {
	const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const base = mkdtempSync(join(tmpdir(), "tab-host-clone-"));
	const run = (cwd: string, ...args: string[]) => {
		const result = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], { cwd });
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	};
	const work = join(base, "work");
	run(base, "init", "-q", "-b", "main", work);
	writeFileSync(join(work, "README.md"), "# cloned\n");
	run(work, "add", ".");
	run(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "initial");
	run(base, "clone", "-q", "--bare", work, join(base, "repo.git"));
	run(join(base, "repo.git"), "config", "http.receivepack", "false");

	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const cgi = Bun.spawn(["git", "http-backend"], {
				env: {
					GIT_PROJECT_ROOT: base,
					GIT_HTTP_EXPORT_ALL: "1",
					PATH_INFO: url.pathname,
					QUERY_STRING: url.search.slice(1),
					REQUEST_METHOD: request.method,
					CONTENT_TYPE: request.headers.get("content-type") ?? "",
					PATH: process.env.PATH ?? "",
				},
				stdin: request.body ? new Uint8Array(await request.arrayBuffer()) : "ignore",
				stdout: "pipe",
			});
			const output = new Uint8Array(await new Response(cgi.stdout).arrayBuffer());
			const split = output.findIndex(
				(_, i) =>
					output[i] === 13 && output[i + 1] === 10 && output[i + 2] === 13 && output[i + 3] === 10,
			);
			const headers = new Headers();
			let status = 200;
			for (const line of new TextDecoder().decode(output.subarray(0, split)).split("\r\n")) {
				const [name, ...value] = line.split(": ");
				if (name?.toLowerCase() === "status") status = Number.parseInt(value.join(": "), 10);
				else if (name) headers.set(name, value.join(": "));
			}
			return new Response(output.subarray(split + 4), { status, headers });
		},
	});
	try {
		const { fs, host, request } = harness();
		await host.start();
		const project = (await request("project.clone", {
			url: `http://localhost:${server.port}/repo.git`,
			parentPath: "/projects",
			name: "cloned",
			corsProxy: "",
		})) as { id: string; path: string; hasGit: boolean };
		expect(project.hasGit).toBe(true);
		expect(fs.readFileSync(`${project.path}/README.md`, "utf8")).toBe("# cloned\n");
		const { commits } = (await request("git.listCommits", { workspaceId: `ws_${project.id}` })) as {
			commits: { subject: string }[];
		};
		expect(commits.map((c) => c.subject)).toEqual(["initial"]);

		writeFileSync(join(work, "README.md"), "# cloned\nmore\n");
		run(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "second");
		run(work, "push", "-q", join(base, "repo.git"), "main");
		const { createShell } = await import("./shell");
		const pulled = await createShell(fs, project.path).exec("git pull");
		expect(pulled.stdout).toContain("Fast-forward");
		expect(fs.readFileSync(`${project.path}/README.md`, "utf8")).toBe("# cloned\nmore\n");
	} finally {
		server.stop(true);
		rmSync(base, { recursive: true, force: true });
	}
});

test("file and blob URLs read bytes from the tab filesystem and from git", async () => {
	const { fs, host, request } = harness();
	await host.start();
	const project = (await request("project.create", { parentPath: "/projects", name: "pics" })) as {
		id: string;
		path: string;
	};
	const workspaceId = `ws_${project.id}`;
	fs.writeFileSync(`${project.path}/dot.png`, new Uint8Array([137, 80, 78, 71]));
	const file = await host.readBytes(`/files/${workspaceId}/dot.png`);
	expect(file.mime).toBe("image/png");
	expect([...file.bytes]).toEqual([137, 80, 78, 71]);

	fs.writeFileSync(`${project.path}/a.txt`, "first\n");
	const { commitAll, headText } = await import("./git");
	await commitAll(fs, project.path, "first");
	fs.writeFileSync(`${project.path}/a.txt`, "second\n");
	const { oid } = await headText(fs, project.path, "a.txt");
	const blob = await host.readBytes(`/blob/${workspaceId}/${oid}/a.txt`);
	expect(new TextDecoder().decode(blob.bytes)).toBe("first\n");
});

test("closing pushes the closed project; deleting removes its files and resends the welcome", async () => {
	const { fs, host, request, pushes } = harness();
	await host.start();
	const kept = (await request("project.create", { parentPath: "/projects", name: "kept" })) as {
		id: string;
	};
	const gone = (await request("project.create", { parentPath: "/projects", name: "gone" })) as {
		id: string;
		path: string;
	};
	await request("project.close", { id: kept.id });
	expect(pushes("project.updated").at(-1)).toEqual(
		expect.objectContaining({ id: kept.id, closed: true }),
	);

	await request("project.delete", { id: gone.id });
	expect(fs.existsSync(gone.path)).toBe(false);
	const welcome = pushes("server.welcome").at(-1) as { recentProjects: { id: string }[] };
	expect(welcome.recentProjects.map((project) => project.id)).toEqual([kept.id]);
});

test("the clone dialog previews a free destination and rejects a taken one", async () => {
	const { fs, host, request } = harness();
	await host.start();
	const preview = (await request("project.cloneDestination", {
		parentPath: "/projects",
		name: "ky",
	})) as { path: string };
	expect(preview.path).toBe("/projects/ky");
	fs.mkdirSync("/projects/ky", { recursive: true });
	await expect(
		request("project.cloneDestination", { parentPath: "/projects", name: "ky" }),
	).rejects.toThrow("already exists");
});
