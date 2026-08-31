import { describe, expect, it } from "bun:test";
import { exemptedPiImports, importsOf, violationsIn } from "./check-architecture";

const unit = (path: string, ...lines: string[]) => ({ path, source: lines.join("\n") });

const PI_REASON =
	"only packages/pi-agent and the portable pi extensions may import a pi package " +
	"(value or type, any subpath)";
const SDK_REASON =
	"only packages/acp/src/capabilities, packages/acp/src/client, packages/acp/src/connection, " +
	"packages/acp/src/testing, packages/acp/src/translate may import the ACP SDK on the client side, " +
	"and packages/pi-agent on the agent side";
const CONTRACTS_REASON =
	"packages/contracts imports nothing — no workspace package, no npm package, no node builtin";
const META_REASON =
	"packages/acp/src/meta stays dependency-free so packages/pi-agent can import it " +
	"without inheriting a graph";
const ACP_HOST_REASON =
	"packages/acp reaches the host only through injected delegates, never a @thinkrail/server import";
const WEB_REASON =
	"apps/web ships without a host — @thinkrail/contracts is the only workspace package it may import";

const TEST_EXEMPTIONS: { readonly [path: string]: string } = {
	"packages/server/src/auth": "test fixture",
	"packages/server/src/dev.ts": "test fixture",
	"packages/server/src/history": "test fixture",
};

describe("the import scan reads code, not text", () => {
	it("collects every import form and ignores specifiers named in comments and strings", () => {
		expect(
			importsOf(
				unit(
					"packages/server/src/host/boot.ts",
					'// import { ModelRuntime } from "@earendil-works/pi-coding-agent";',
					'/* import "@agentclientprotocol/sdk"; */',
					"const doc = 'import x from \"@earendil-works/pi-ai\"';",
					'import { WS_METHODS } from "@thinkrail/contracts";',
					'export type { Chat } from "@thinkrail/contracts";',
					'const shared = await import("@thinkrail/shared");',
					'const fs = require("node:fs");',
					'const resolved = Bun.resolveSync("@earendil-works/pi-ai", root);',
				),
			),
		).toEqual([
			{ specifier: "@thinkrail/contracts", line: 4 },
			{ specifier: "@thinkrail/contracts", line: 5 },
			{ specifier: "@thinkrail/shared", line: 6 },
			{ specifier: "node:fs", line: 7 },
		]);
	});

	it("reads tsx", () => {
		expect(
			importsOf(
				unit(
					"apps/web/src/panels/ChatPanel.tsx",
					'import type { ChatId } from "@thinkrail/contracts";',
					"export const Panel = (id: ChatId) => <div data-testid={id} />;",
				),
			),
		).toEqual([{ specifier: "@thinkrail/contracts", line: 1 }]);
	});
});

describe("pi stays in the agent package", () => {
	it("catches a value import, a type import and a dynamic one, anywhere in the host", () => {
		expect(
			violationsIn([
				unit(
					"packages/server/src/transcript/store.ts",
					'import { getAgentDir } from "@earendil-works/pi-coding-agent";',
				),
				unit(
					"packages/server/src/projects/projects.ts",
					'import type { Provider } from "@earendil-works/pi-ai";',
				),
				unit(
					"packages/contracts/src/domain.ts",
					'const models = await import("@earendil-works/pi-ai/providers/all");',
				),
			]),
		).toEqual([
			`packages/server/src/transcript/store.ts:1: imports "@earendil-works/pi-coding-agent" — ${PI_REASON}`,
			`packages/server/src/projects/projects.ts:1: imports "@earendil-works/pi-ai" — ${PI_REASON}`,
			`packages/contracts/src/domain.ts:1: imports "@earendil-works/pi-ai/providers/all" — ${CONTRACTS_REASON}`,
		]);
	});

	it("lets the pi-side packages and the listed exemption import pi", () => {
		expect(
			violationsIn(
				[
					unit(
						"packages/pi-agent/src/session.ts",
						'import { createAgentSession } from "@earendil-works/pi-coding-agent";',
					),
					unit(
						"packages/spec-graph/tools/get.ts",
						'import type { Tool } from "@earendil-works/pi-agent-core";',
					),
					unit(
						"packages/pi-todos/tools/add.ts",
						'import type { Tool } from "@earendil-works/pi-agent-core";',
					),
					unit(
						"packages/pi-agent/src/engine/piRuntime.ts",
						'import { ModelRuntime } from "@earendil-works/pi-coding-agent";',
					),
					unit(
						"packages/server/src/dev.ts",
						'import type { Provider } from "@earendil-works/pi-ai";',
					),
				],
				TEST_EXEMPTIONS,
			),
		).toEqual([]);
	});

	it("does not extend the exemption to the rest of the host package", () => {
		expect(
			violationsIn([
				unit(
					"packages/server/src/agentless/runner.ts",
					'import { ModelRuntime } from "@earendil-works/pi-coding-agent";',
				),
			]),
		).toEqual([
			`packages/server/src/agentless/runner.ts:1: imports "@earendil-works/pi-coding-agent" — ${PI_REASON}`,
		]);
	});
});

describe("the ACP SDK stops at the translating sub-modules", () => {
	it("catches it in the package barrel, in registry, in meta and outside the package", () => {
		expect(
			violationsIn([
				unit(
					"packages/acp/src/index.ts",
					'export type { ToolCall } from "@agentclientprotocol/sdk";',
				),
				unit(
					"packages/acp/src/registry/resolve.ts",
					'import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";',
				),
				unit(
					"packages/acp/src/meta/types.ts",
					'import type { X } from "@agentclientprotocol/sdk";',
				),
				unit(
					"packages/server/src/host/boot.ts",
					'import type { ToolCall } from "@agentclientprotocol/sdk";',
				),
				unit(
					"apps/web/src/chat/toolRegistry.ts",
					'import type { ToolCall } from "@agentclientprotocol/sdk";',
				),
				unit(
					"packages/contracts/src/chatProtocol.ts",
					'import type { ToolCall } from "@agentclientprotocol/sdk";',
				),
			]),
		).toEqual([
			`packages/acp/src/index.ts:1: imports "@agentclientprotocol/sdk" — ${SDK_REASON}`,
			`packages/acp/src/registry/resolve.ts:1: imports "@agentclientprotocol/sdk" — ${SDK_REASON}`,
			`packages/acp/src/meta/types.ts:1: imports "@agentclientprotocol/sdk" — ${META_REASON}`,
			`packages/server/src/host/boot.ts:1: imports "@agentclientprotocol/sdk" — ${SDK_REASON}`,
			`apps/web/src/chat/toolRegistry.ts:1: imports "@agentclientprotocol/sdk" — ${SDK_REASON}`,
			`packages/contracts/src/chatProtocol.ts:1: imports "@agentclientprotocol/sdk" — ${CONTRACTS_REASON}`,
		]);
	});

	it("lets packages/pi-agent import it, because it implements the agent side", () => {
		expect(
			violationsIn([
				unit(
					"packages/pi-agent/src/acp/app.ts",
					'import { AgentSideConnection } from "@agentclientprotocol/sdk";',
				),
				unit(
					"packages/pi-agent/src/acp/updates.ts",
					'import type { SessionNotification } from "@agentclientprotocol/sdk";',
				),
			]),
		).toEqual([]);
	});

	it("lets the five translating sub-modules and their tests import it", () => {
		expect(
			violationsIn([
				unit(
					"packages/acp/src/connection/connect.ts",
					'import { ClientSideConnection } from "@agentclientprotocol/sdk";',
				),
				unit(
					"packages/acp/src/translate/toolCall.ts",
					'import type { ToolCall } from "@agentclientprotocol/sdk";',
				),
				unit(
					"packages/acp/src/capabilities/negotiate.ts",
					'import type { AgentCapabilities } from "@agentclientprotocol/sdk";',
				),
				unit(
					"packages/acp/src/client/handlers.ts",
					'import type { ReadTextFileRequest } from "@agentclientprotocol/sdk";',
				),
				unit(
					"packages/acp/src/testing/fakeAgent.ts",
					'import { AgentSideConnection } from "@agentclientprotocol/sdk";',
				),
				unit(
					"packages/acp/src/translate/permission.test.ts",
					'import { describe } from "bun:test";',
					'import type { PermissionOption } from "@agentclientprotocol/sdk";',
				),
			]),
		).toEqual([]);
	});
});

describe("packages/contracts imports nothing", () => {
	it("catches an npm package, a workspace package and a node builtin in a source file", () => {
		expect(
			violationsIn([
				unit("packages/contracts/src/domain.ts", 'import { z } from "zod";'),
				unit("packages/contracts/src/index.ts", 'export * from "@thinkrail/shared";'),
				unit("packages/contracts/src/wsProtocol.ts", 'import { randomUUID } from "node:crypto";'),
			]),
		).toEqual([
			`packages/contracts/src/domain.ts:1: imports "zod" — ${CONTRACTS_REASON}`,
			`packages/contracts/src/index.ts:1: imports "@thinkrail/shared" — ${CONTRACTS_REASON}`,
			`packages/contracts/src/wsProtocol.ts:1: imports "node:crypto" — ${CONTRACTS_REASON}`,
		]);
	});

	it("lets its own test reach the runner and the disk it reads, and keeps relative imports", () => {
		expect(
			violationsIn([
				unit(
					"packages/contracts/src/boundary.test.ts",
					'import { describe, expect, it } from "bun:test";',
					'import { readFileSync } from "node:fs";',
					'import { WS_METHODS } from "./wsProtocol";',
				),
				unit("packages/contracts/src/index.ts", 'export * from "./domain";'),
			]),
		).toEqual([]);
	});

	it("still forbids an npm package inside the test", () => {
		expect(
			violationsIn([unit("packages/contracts/src/domain.test.ts", 'import { z } from "zod";')]),
		).toEqual([`packages/contracts/src/domain.test.ts:1: imports "zod" — ${CONTRACTS_REASON}`]);
	});
});

describe("apps/web depends on packages/contracts only", () => {
	it("catches the host, the shell helpers, the ACP client and pi — one line per import", () => {
		expect(
			violationsIn([
				unit(
					"apps/web/src/transport/ws.ts",
					'import { createServer } from "@thinkrail/server";',
					'import { shellEnv } from "@thinkrail/shared";',
					'import { connectAgent } from "@thinkrail/acp";',
					'import { THINKRAIL_META_KEY } from "@thinkrail/acp/meta";',
					'import type { Provider } from "@earendil-works/pi-ai";',
				),
			]),
		).toEqual([
			`apps/web/src/transport/ws.ts:1: imports "@thinkrail/server" — ${WEB_REASON}`,
			`apps/web/src/transport/ws.ts:2: imports "@thinkrail/shared" — ${WEB_REASON}`,
			`apps/web/src/transport/ws.ts:3: imports "@thinkrail/acp" — ${WEB_REASON}`,
			`apps/web/src/transport/ws.ts:4: imports "@thinkrail/acp/meta" — ${WEB_REASON}`,
			`apps/web/src/transport/ws.ts:5: imports "@earendil-works/pi-ai" — ${WEB_REASON}`,
		]);
	});

	it("leaves the wire, npm packages and the rest of the repo alone", () => {
		expect(
			violationsIn([
				unit(
					"apps/web/src/store/store.ts",
					'import { create } from "zustand";',
					'import type { ChatId } from "@thinkrail/contracts";',
				),
				unit("apps/cli/src/main.ts", 'import { createServer } from "@thinkrail/server";'),
			]),
		).toEqual([]);
	});
});

describe("packages/acp never imports the host", () => {
	it("catches @thinkrail/server and any subpath of it", () => {
		expect(
			violationsIn([
				unit(
					"packages/acp/src/connection/connect.ts",
					'import type { WorktreeFs } from "@thinkrail/server";',
				),
				unit(
					"packages/acp/src/client/handlers.ts",
					'import { readFile } from "@thinkrail/server/fs";',
				),
			]),
		).toEqual([
			`packages/acp/src/connection/connect.ts:1: imports "@thinkrail/server" — ${ACP_HOST_REASON}`,
			`packages/acp/src/client/handlers.ts:1: imports "@thinkrail/server/fs" — ${ACP_HOST_REASON}`,
		]);
	});
});

describe("packages/acp/src/meta stays dependency-free", () => {
	it("catches the wire, the SDK, a node builtin and a sibling package", () => {
		expect(
			violationsIn([
				unit(
					"packages/acp/src/meta/types.ts",
					'import type { ChatId } from "@thinkrail/contracts";',
				),
				unit("packages/acp/src/meta/namespace.ts", 'import { readFileSync } from "node:fs";'),
				unit("packages/acp/src/meta/index.ts", 'import { z } from "zod";'),
			]),
		).toEqual([
			`packages/acp/src/meta/types.ts:1: imports "@thinkrail/contracts" — ${META_REASON}`,
			`packages/acp/src/meta/namespace.ts:1: imports "node:fs" — ${META_REASON}`,
			`packages/acp/src/meta/index.ts:1: imports "zod" — ${META_REASON}`,
		]);
	});

	it("leaves its own siblings alone", () => {
		expect(
			violationsIn([
				unit("packages/acp/src/meta/namespace.ts", 'import { IDS } from "./types";'),
				unit("packages/acp/src/meta/index.ts", 'export type { MetaBag } from "./namespace";'),
			]),
		).toEqual([]);
	});
});

describe("a repo-shaped clean tree passes", () => {
	it("reports nothing", () => {
		expect(
			violationsIn([
				unit("packages/contracts/src/index.ts", 'export * from "./domain";'),
				unit(
					"packages/acp/src/translate/assembler.ts",
					'import type { SessionNotification } from "@agentclientprotocol/sdk";',
					'import type { ChatBlock } from "@thinkrail/contracts";',
					'import { readThinkRailMeta } from "../meta";',
				),
				unit(
					"packages/server/src/transcript/store.ts",
					'import { mkdirSync } from "node:fs";',
					'import type { ChatId } from "@thinkrail/contracts";',
				),
				unit(
					"apps/web/src/chat/ChatView.tsx",
					'import { MessageSquare } from "lucide-react";',
					'import type { ChatId } from "@thinkrail/contracts";',
				),
				unit(
					"packages/pi-todos/tools/add.ts",
					'import type { Tool } from "@earendil-works/pi-agent-core";',
				),
				unit(
					"packages/pi-agent/src/engine/piRuntime.ts",
					'import { ModelRuntime } from "@earendil-works/pi-coding-agent";',
				),
			]),
		).toEqual([]);
	});
});

describe("the pi exemptions expire on their own", () => {
	it("counts only pi imports under each exempt path, leaving the unused ones at zero", () => {
		expect(
			exemptedPiImports(
				[
					unit(
						"packages/server/src/auth/login.ts",
						'import { ModelRuntime } from "@earendil-works/pi-coding-agent";',
						'import type { Provider } from "@earendil-works/pi-ai";',
						'import type { ChatId } from "@thinkrail/contracts";',
					),
					unit(
						"packages/server/src/dev.ts",
						'import type { Provider } from "@earendil-works/pi-ai";',
					),
					unit(
						"packages/server/src/transcript/store.ts",
						'import { getAgentDir } from "@earendil-works/pi-coding-agent";',
					),
				],
				TEST_EXEMPTIONS,
			),
		).toEqual(
			new Map([
				["packages/server/src/auth", 2],
				["packages/server/src/dev.ts", 1],
				["packages/server/src/history", 0],
			]),
		);
	});

	it("reports nothing to expire once the exemption list is empty", () => {
		expect(
			exemptedPiImports(
				[
					unit(
						"packages/pi-agent/src/engine/piRuntime.ts",
						'import { ModelRuntime } from "@earendil-works/pi-coding-agent";',
					),
				],
				{},
			),
		).toEqual(new Map());
	});
});
