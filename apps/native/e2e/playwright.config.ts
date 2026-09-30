import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { resolveBunExecutable } from "../../../e2e/fixtures/executables";
import { e2eHostEnv } from "../../../e2e/fixtures/hostEnv";
import { E2E_PORT } from "../../../e2e/fixtures/paths";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));

export default defineConfig({
	testDir: ".",
	testMatch: "*.spec.ts",
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: "list",
	globalSetup: "./global-setup.ts",
	globalTeardown: "../../../e2e/global-teardown.ts",
	webServer: {
		command: `${JSON.stringify(resolveBunExecutable())} packages/server/src/dev.ts`,
		cwd: rootDir,
		url: `http://127.0.0.1:${E2E_PORT}/health`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: { ...e2eHostEnv(false, fileURLToPath(new URL("../../web/dist", import.meta.url))), THINKRAIL_HOST: "127.0.0.1" },
	},
});
