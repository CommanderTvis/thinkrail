import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { CENTRAL_STUB_READ_ONLY_ENV, REAL_CENTRAL_E2E_ENV } from "./centralAgent";
import { hermeticE2ePath } from "./executables";
import {
	E2E_CENTRAL_BAD_EXTENSION_SOURCE,
	E2E_CENTRAL_EXTENSION_SOURCE,
	E2E_CENTRAL_LOG,
	E2E_CENTRAL_STATE,
	E2E_DATA_DIR,
	E2E_EDITOR_LOG,
	E2E_FAKE_BIN_DIR,
	E2E_HOME_DIR,
	E2E_PI_AGENT_DIR,
	E2E_PICK_DIR_POINTER,
	E2E_PORT,
} from "./paths";

export function e2eHostEnv(centralMode: boolean, staticDir: string): Record<string, string> {
	const hostPath = hermeticE2ePath(E2E_FAKE_BIN_DIR);
	if (hostPath.split(delimiter).some((directory) => existsSync(join(directory, "pi"))))
		throw new Error("e2e host PATH must not contain pi");
	return {
		THINKRAIL_PORT: String(E2E_PORT),
		THINKRAIL_STATIC_DIR: staticDir,
		THINKRAIL_DATA_DIR: E2E_DATA_DIR,
		DISPLAY: "",
		WAYLAND_DISPLAY: "",
		// Stub the host's native directory picker so "Open project" is drivable headlessly. It names a
		// control *file* (seeded to the git fixture in globalSetup); a test can rewrite it to hand the
		// picker a different folder (e.g. a non-git one) without restarting the shared host.
		THINKRAIL_PICK_DIR: E2E_PICK_DIR_POINTER,
		// Force the New-Workspace dialog's `gh` probe to "Not connected" so the suite is deterministic
		// regardless of the dev machine's real `gh` auth — and exercises the offline/local-branch degrade path.
		THINKRAIL_GH_OFFLINE: "1",
		// Keep cross-agent personal skill aliases away from the developer's real homes/overrides.
		HOME: E2E_HOME_DIR,
		USERPROFILE: E2E_HOME_DIR,
		CLAUDE_CONFIG_DIR: `${E2E_HOME_DIR}/.claude`,
		CODEX_HOME: `${E2E_HOME_DIR}/.codex`,
		GEMINI_CLI_HOME: E2E_HOME_DIR,
		PI_CODING_AGENT_DIR: E2E_PI_AGENT_DIR,
		// Keep the suite hermetic: `model.list` fires a detached pi.dev catalog refresh (issue #98) that
		// must never leave the machine in tests — PI_OFFLINE is pi's own convention and our guard honors it.
		PI_OFFLINE: "1",
		// Lane-local `central` + `code` stubs: deterministic and safe under process-level sharding.
		PATH: hostPath,
		CENTRAL_STUB_STATE: E2E_CENTRAL_STATE,
		CENTRAL_STUB_LOG: E2E_CENTRAL_LOG,
		CENTRAL_STUB_EXTENSION_SOURCE: E2E_CENTRAL_EXTENSION_SOURCE,
		CENTRAL_STUB_BAD_EXTENSION_SOURCE: E2E_CENTRAL_BAD_EXTENSION_SOURCE,
		...(centralMode
			? {
					[REAL_CENTRAL_E2E_ENV]: "1",
					[CENTRAL_STUB_READ_ONLY_ENV]: "1",
				}
			: {}),
		// Where the stub `code` appends each invocation's argv, so a test can assert "Open in VS Code"
		// actually launched with the right worktree path.
		THINKRAIL_E2E_EDITOR_LOG: E2E_EDITOR_LOG,
		// Register a deterministic fake OAuth provider (`e2e-oauth`) so the in-app login flow is drivable
		// end-to-end without a real provider/browser (see packages/server/src/dev.ts).
		THINKRAIL_E2E_FAKE_OAUTH: centralMode ? "0" : "1",
		CI: "1",
	};
}
