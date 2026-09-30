import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { assertCentralPlaywrightRunner } from "./e2e/agentRunPlan";
import { isRealCentralE2e } from "./e2e/fixtures/centralAgent";
import { resolveBunExecutable } from "./e2e/fixtures/executables";
import { e2eHostEnv } from "./e2e/fixtures/hostEnv";
import { E2E_PORT } from "./e2e/fixtures/paths";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const staticDir = fileURLToPath(new URL("./apps/web/dist", import.meta.url));
// Per-worktree derived port (e2e/fixtures/paths.ts) — parallel worktrees (this product's own working
// model) run their suites concurrently without fighting over one port, zero config; the dev host
// (24242) stays clear. Slot clashes are auto-arbitrated by an atomic claim registry
// (e2e/fixtures/portBlock.ts). Supersedes the manual THINKRAIL_E2E_PORT knob
// (THINKRAIL_E2E_PORT_BASE pins the whole per-worktree block explicitly when ever needed).
const PORT = E2E_PORT;
const centralMode = isRealCentralE2e();
assertCentralPlaywrightRunner(process.env, process.argv);
const bunExecutable = resolveBunExecutable();
const isShardLane = process.env.THINKRAIL_E2E_LANE !== undefined;
const hostCommand =
	process.env.THINKRAIL_E2E_SKIP_BUILD === "1"
		? `${JSON.stringify(bunExecutable)} packages/server/src/dev.ts`
		: `${JSON.stringify(bunExecutable)} run build:web && ${JSON.stringify(bunExecutable)} packages/server/src/dev.ts`;
export default defineConfig({
	testDir: "./e2e",
	// The headless workflow-test suite has its own config (playwright.workflows.config.ts) — no browser,
	// no webServer; `bun run test:workflows`. Never picked up by the browser suites.
	testIgnore: "workflows/**",
	...(centralMode ? { grep: /@agent/ } : { grepInvert: /@agent/ }),
	// One worker owns one stateful host. Shard lanes stay serial internally; fullyParallel only lets
	// Playwright distribute individual tests (rather than uneven whole files) across separate processes.
	fullyParallel: isShardLane,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	timeout: 30_000,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
	globalSetup: "./e2e/global-setup.ts",
	globalTeardown: "./e2e/global-teardown.ts",
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	// Self-contained: build the web app, boot the host on an isolated port + state dir, and tear it all
	// down after. `bun run e2e` needs nothing else running.
	webServer: {
		command: hostCommand,
		cwd: rootDir,
		url: `http://localhost:${PORT}/health`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: e2eHostEnv(centralMode, staticDir),
	},
});
