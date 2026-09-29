import type { PluginOrigin } from "@thinkrail/contracts";
import {
	PLUGIN_API_GENERATION,
	PLUGIN_ID_PATTERN,
	type PluginManifest,
} from "@thinkrail/plugin-api";
import { Type } from "typebox";
import { Value } from "typebox/value";

const PluginDependencySchema = Type.Object({
	id: Type.String(),
	wireVersion: Type.Number(),
});

const SideToolContributionSchema = Type.Object({
	tool: Type.String(),
	label: Type.String(),
	description: Type.Optional(Type.String()),
	icon: Type.String(),
	defaultSide: Type.Union([Type.Literal("left"), Type.Literal("right")]),
	requiresGit: Type.Optional(Type.Literal(true)),
});

const FileViewerContributionSchema = Type.Object({
	extensions: Type.Array(Type.String()),
	names: Type.Array(Type.String()),
	read: Type.Union([Type.Literal("text"), Type.Literal("none")]),
});

const ContributionsSchema = Type.Object({
	sideTools: Type.Array(SideToolContributionSchema),
	fileViewers: Type.Array(FileViewerContributionSchema),
});

const PiBlockSchema = Type.Object({
	extensions: Type.Array(Type.String()),
	skills: Type.Array(Type.String()),
	reachesSubagents: Type.Boolean(),
	modifiesSystemPrompt: Type.Boolean(),
});

export const PluginManifestSchema = Type.Object({
	id: Type.String({ pattern: PLUGIN_ID_PATTERN.source }),
	label: Type.String(),
	icon: Type.String(),
	version: Type.String(),
	apiGeneration: Type.Number(),
	wireVersion: Type.Number(),
	enabledByDefault: Type.Boolean(),
	dependsOn: Type.Array(PluginDependencySchema),
	host: Type.Optional(Type.String()),
	web: Type.Optional(Type.String()),
	styles: Type.Optional(Type.String()),
	assets: Type.Optional(Type.String()),
	contributes: ContributionsSchema,
	pi: Type.Optional(PiBlockSchema),
});

export type ManifestValidation = { manifest: PluginManifest } | { refused: string };

function firstSchemaError(value: unknown): string {
	const [first] = Value.Errors(PluginManifestSchema, value);
	return first ? `${first.instancePath || "manifest"}: ${first.message}` : "manifest is invalid";
}

export function validateManifest(
	value: unknown,
	origin: PluginOrigin,
	directoryName?: string,
): ManifestValidation {
	if (!Value.Check(PluginManifestSchema, value)) {
		return { refused: `invalid manifest: ${firstSchemaError(value)}` };
	}
	const manifest = value as PluginManifest;
	if (origin === "external" && directoryName !== undefined && manifest.id !== directoryName) {
		return {
			refused: `plugin id "${manifest.id}" does not match its directory "${directoryName}"`,
		};
	}
	if (manifest.apiGeneration !== PLUGIN_API_GENERATION) {
		return {
			refused: `plugin ${manifest.id} declares apiGeneration ${manifest.apiGeneration}, host expects ${PLUGIN_API_GENERATION}`,
		};
	}
	return { manifest };
}
