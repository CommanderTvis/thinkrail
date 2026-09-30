import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { E2E_PORT } from "../../../../e2e/fixtures/paths";

export const E2E_HOST_PORT = E2E_PORT;
export const AUTOMATION_PORT = E2E_PORT + 6;
export const OBSERVER_AUTOMATION_PORT = E2E_PORT + 7;
export const PROXY_PORT = E2E_PORT + 8;
export const OBSERVER_PROXY_PORT = E2E_PORT + 9;
export const BUNDLE_ID = "org.reactjs.native.ThinkRailNative";

export function nativeAppPath(): string {
	const explicit = process.env.THINKRAIL_NATIVE_E2E_APP;
	if (explicit) return explicit;
	const derived = join(homedir(), "Library", "Developer", "Xcode", "DerivedData");
	const builds = (existsSync(derived) ? readdirSync(derived) : [])
		.filter((entry) => entry.startsWith("ThinkRailNative-"))
		.map((entry) => join(derived, entry, "Build", "Products", "Release", "ThinkRailNative.app"))
		.filter((app) => existsSync(app))
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
	if (builds[0]) return builds[0];
	throw new Error("No Release ThinkRailNative.app; run `bun run build:macos` or set THINKRAIL_NATIVE_E2E_APP");
}
