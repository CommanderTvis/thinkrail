import { join } from "node:path";

/**
 * Where the staged Claude Code marketplace and its plugin sit inside the bundle. One definition, because
 * three places need the same shape — the build that stages it, the app that hands the host its path, and
 * the smoke that proves it shipped — and the host derives the marketplace from the plugin's own parent.
 */
export function stagedClaudePlugin(runtimeDir: string): {
	marketplaceRoot: string;
	manifest: string;
	pluginDir: string;
} {
	const marketplaceRoot = join(runtimeDir, "claude");
	return {
		marketplaceRoot,
		manifest: join(marketplaceRoot, ".claude-plugin", "marketplace.json"),
		pluginDir: join(marketplaceRoot, "packages", "claude-plugin"),
	};
}
