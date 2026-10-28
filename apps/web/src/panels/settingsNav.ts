import {
	type RemixiconComponentType,
	RiApps2Line,
	RiBrainLine,
	RiChat2Line,
	RiDownloadCloud2Line,
	RiFolderSettingsLine,
	RiGitRepositoryLine,
	RiKeyLine,
	RiLayoutGridLine,
	RiLayoutTop2Line,
	RiNotification3Line,
	RiPaletteLine,
	RiPlugLine,
	RiPuzzle2Line,
	RiShieldCheckLine,
	RiTerminalBoxLine,
	RiTranslate2,
} from "@remixicon/react";
import {
	DEFAULT_MODEL_PROTOCOL_VERSION,
	EXTENSION_CATALOG_PROTOCOL_VERSION,
	HOST_ENVIRONMENT_PROTOCOL_VERSION,
	LOCALES_PROTOCOL_VERSION,
	MCP_PROTOCOL_VERSION,
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { SettingsSection } from "@/store";
import { hostMode } from "@/transport";

export interface SettingsNavSection {
	id: SettingsSection;
	label: MessageKey;
	icon: RemixiconComponentType;
	requiresInjectedContent?: true;
	requiresProtocolVersion?: number;
	/** Needs a process host: hidden while ThinkRail runs in this browser tab. */
	needsProcessHost?: true;
}

export interface SettingsNavGroup {
	label: MessageKey;
	sections: SettingsNavSection[];
}

const NAV_GROUPS: SettingsNavGroup[] = [
	{
		label: "settings.nav.group.agent",
		sections: [
			{
				id: SettingsSection.Models,
				label: "settings.nav.models",
				icon: RiBrainLine,
				requiresProtocolVersion: DEFAULT_MODEL_PROTOCOL_VERSION,
			},
			{ id: SettingsSection.Providers, label: "settings.nav.providers", icon: RiKeyLine },
			{
				id: SettingsSection.Mcp,
				label: "settings.nav.mcp",
				icon: RiPlugLine,
				requiresProtocolVersion: MCP_PROTOCOL_VERSION,
				needsProcessHost: true,
			},
			{
				id: SettingsSection.Templates,
				label: "settings.nav.templates",
				icon: RiLayoutGridLine,
				needsProcessHost: true,
			},
			{
				id: SettingsSection.Environment,
				label: "settings.nav.environment",
				icon: RiFolderSettingsLine,
				requiresProtocolVersion: HOST_ENVIRONMENT_PROTOCOL_VERSION,
				needsProcessHost: true,
			},
		],
	},
	{
		label: "settings.nav.group.interface",
		sections: [
			{ id: SettingsSection.Chat, label: "settings.nav.chat", icon: RiChat2Line },
			{ id: SettingsSection.Appearance, label: "settings.nav.appearance", icon: RiPaletteLine },
			{
				id: SettingsSection.Language,
				label: "settings.nav.language",
				icon: RiTranslate2,
				requiresProtocolVersion: LOCALES_PROTOCOL_VERSION,
			},
			{ id: SettingsSection.Layout, label: "settings.nav.layout", icon: RiLayoutTop2Line },
			{
				id: SettingsSection.Terminal,
				label: "settings.nav.terminal",
				icon: RiTerminalBoxLine,
				needsProcessHost: true,
			},
		],
	},
	{
		label: "settings.nav.group.system",
		sections: [
			{
				id: SettingsSection.Workspaces,
				label: "settings.nav.workspaces",
				icon: RiGitRepositoryLine,
				requiresProtocolVersion: WORKSPACE_SETTLE_PROTOCOL_VERSION,
				needsProcessHost: true,
			},
			{
				id: SettingsSection.Github,
				label: "settings.nav.github",
				icon: RiApps2Line,
				needsProcessHost: true,
			},
			{
				id: SettingsSection.Extensions,
				label: "settings.nav.extensions",
				icon: RiPuzzle2Line,
				requiresProtocolVersion: EXTENSION_CATALOG_PROTOCOL_VERSION,
				needsProcessHost: true,
			},
			{ id: SettingsSection.Plugins, label: "settings.nav.plugins", icon: RiPuzzle2Line },
			{
				id: SettingsSection.Notifications,
				label: "settings.nav.notifications",
				icon: RiNotification3Line,
			},
			{ id: SettingsSection.Privacy, label: "settings.nav.privacy", icon: RiShieldCheckLine },
			{
				id: SettingsSection.Updates,
				label: "settings.nav.updates",
				icon: RiDownloadCloud2Line,
				requiresInjectedContent: true,
				needsProcessHost: true,
			},
		],
	},
];

function isAvailable(
	section: SettingsNavSection,
	protocolVersion: number | null,
	hasUpdates: boolean,
	inTab: boolean,
): boolean {
	return (
		!(inTab && section.needsProcessHost) &&
		(!section.requiresInjectedContent || hasUpdates) &&
		(section.requiresProtocolVersion === undefined ||
			(protocolVersion !== null && protocolVersion >= section.requiresProtocolVersion))
	);
}

export function settingsNavGroups(
	protocolVersion: number | null,
	hasUpdates: boolean,
): SettingsNavGroup[] {
	return filterSettingsNavGroups(NAV_GROUPS, protocolVersion, hasUpdates, hostMode() === "tab");
}

export function filterSettingsNavGroups(
	groups: SettingsNavGroup[],
	protocolVersion: number | null,
	hasUpdates: boolean,
	inTab = false,
): SettingsNavGroup[] {
	return groups
		.map((group) => ({
			...group,
			sections: group.sections.filter((s) => isAvailable(s, protocolVersion, hasUpdates, inTab)),
		}))
		.filter((group) => group.sections.length > 0);
}

export function resolveSettingsSection(
	section: SettingsSection,
	groups: SettingsNavGroup[],
): SettingsSection {
	const available = groups.flatMap((g) => g.sections);
	if (section === SettingsSection.Feedback || available.some((s) => s.id === section)) {
		return section;
	}
	if (available.some((s) => s.id === SettingsSection.Appearance)) {
		return SettingsSection.Appearance;
	}
	return available[0]?.id ?? SettingsSection.Appearance;
}
