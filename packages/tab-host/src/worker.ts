import "./globals";
import type { PluginHostModule } from "@thinkrail/plugin-api/host";
import blueprintHost from "@thinkrail/plugin-blueprint/host";
import { manifest as blueprintManifest } from "@thinkrail/plugin-blueprint/manifest";
import { manifest as branchGraphManifest } from "@thinkrail/plugin-branch-graph/manifest";
import { manifest as claudeCodeManifest } from "@thinkrail/plugin-claude-code/manifest";
import { manifest as codexManifest } from "@thinkrail/plugin-codex/manifest";
import { manifest as discordManifest } from "@thinkrail/plugin-discord/manifest";
import { manifest as fileIconsManifest } from "@thinkrail/plugin-file-icons/manifest";
import specDialectHost from "@thinkrail/plugin-spec-dialect/host";
import { manifest as specDialectManifest } from "@thinkrail/plugin-spec-dialect/manifest";
import visualizeHost from "@thinkrail/plugin-visualize/host";
import { manifest as visualizeManifest } from "@thinkrail/plugin-visualize/manifest";
import { startTabHost } from "./start";

void startTabHost(globalThis as unknown as DedicatedWorkerScope, {
	modules: [specDialectHost, blueprintHost, visualizeHost] as unknown as PluginHostModule[],
	manifests: [
		specDialectManifest,
		blueprintManifest,
		claudeCodeManifest,
		codexManifest,
		discordManifest,
		visualizeManifest,
		branchGraphManifest,
		fileIconsManifest,
	],
});

interface DedicatedWorkerScope {
	postMessage(message: unknown): void;
	addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}
