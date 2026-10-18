import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import {
	createSyntheticSourceInfo,
	DefaultPackageManager,
	DefaultResourceLoader,
	type ExtensionAPI,
	type ExtensionFactory,
	getAgentDir,
	type InlineExtension,
	type LoadExtensionsResult,
	type PathMetadata,
	type ResourceDiagnostic,
	type ResourceLoader,
	SettingsManager,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import type { SkillCatalogEntry, SlashCommandInfo } from "@thinkrail/contracts";
import {
	omitDisabledRegistryExtensions,
	registryInlineExtensions,
	resolveExtensionSkillRoots,
	serverExtensions,
} from "../extensions";
import { type BundledTrashHelpers, setBundledTrashHelpers } from "../trash";
import {
	type AskUserQuestionWaiters,
	askUserQuestionExtension,
	createAskUserQuestionWaiters,
} from "./askUserQuestion";
import { oversizedImageGuard } from "./imageGuard";
import { requestReviewExtension } from "./requestReviewTool";
import { reviewToolExtension } from "./reviewTool";
import { decideSkill, type SkillAdmissionContext } from "./skillAdmission";
import {
	type CompatibilitySkillSource,
	candidateCompatibilitySkillRoots,
	discoverCompatibilitySkillSources,
} from "./skillSources";
import { setTitleExtension } from "./titleTool";

export type BundledExtensionFactory = ExtensionFactory;

let disabledExtensionsResolver: () => ReadonlySet<string> = () => new Set();

export function setDisabledExtensionsResolver(resolver: () => ReadonlySet<string>): void {
	disabledExtensionsResolver = resolver;
}

export function disabledExtensions(): ReadonlySet<string> {
	try {
		return disabledExtensionsResolver();
	} catch {
		return new Set();
	}
}

export interface BundledPluginRuntime {
	factories: ExtensionFactory[];
	skillsDir: string | null;
	assetsDir: string | null;
}

export interface BundledExtensions {
	factories: BundledExtensionFactory[];
	skillsDir: string;
	trashHelpers: BundledTrashHelpers;
	webAccessFactory: BundledExtensionFactory;
	plugins?: Record<string, BundledPluginRuntime>;
}

let bundled: BundledExtensions | undefined;

const EMPTY_BUNDLED_PLUGIN_RUNTIME: BundledPluginRuntime = {
	factories: [],
	skillsDir: null,
	assetsDir: null,
};

/** A builtin plugin's staged runtime in the compiled binary/desktop, or the empty runtime in dev. */
export function bundledPluginRuntime(id: string): BundledPluginRuntime {
	return bundled?.plugins?.[id] ?? EMPTY_BUNDLED_PLUGIN_RUNTIME;
}

/** What the plugin loader contributes to every session's resources. */
export interface PluginPiResources {
	factories: ExtensionFactory[];
	extensionPaths: string[];
	skillPaths: string[];
	childFactories: ExtensionFactory[];
	toolsExtension: ExtensionFactory;
}

const noopToolsExtension: ExtensionFactory = () => {};

function defaultPluginResources(): PluginPiResources {
	return {
		factories: [],
		extensionPaths: [],
		skillPaths: [],
		childFactories: [],
		toolsExtension: noopToolsExtension,
	};
}

let pluginResourcesProvider: () => PluginPiResources = defaultPluginResources;

/** Installed by the plugin loader: what every session's resource loader should add for active plugins. */
export function setPluginResourcesProvider(fn: (() => PluginPiResources) | null): void {
	pluginResourcesProvider = fn ?? defaultPluginResources;
}

export async function registerBundledRuntime(extensions: BundledExtensions): Promise<void> {
	bundled = extensions;
	setBundledTrashHelpers(extensions.trashHelpers);
	const [{ registerBunOAuthFlows }, { bedrockProviderModule }, { setBedrockProviderModule }] =
		await Promise.all([
			import("@earendil-works/pi-ai/bun-oauth"),
			import("@earendil-works/pi-ai/bedrock-provider"),
			import("@earendil-works/pi-ai/compat"),
		]);
	registerBunOAuthFlows();
	setBedrockProviderModule(bedrockProviderModule);
}

export const PI_EXTENSION_PACKAGES = [
	"pi-web-access",
	"pi-thinkrail-workflow",
	"pi-todos",
] as const;

export type PiExtensionPackage = (typeof PI_EXTENSION_PACKAGES)[number];

function piExtensionResolver(): (name: PiExtensionPackage) => string {
	const require = createRequire(import.meta.url);
	return (name) => require.resolve(`${name}/index.ts`);
}

let devPaths: { extensionPaths: string[]; skillPaths: string[] } | undefined;
function resolveDevPaths(): { extensionPaths: string[]; skillPaths: string[] } {
	if (devPaths) return devPaths;
	const resolveEntry = piExtensionResolver();
	const webAccessPath = resolveEntry("pi-web-access");
	const workflowPath = resolveEntry("pi-thinkrail-workflow");
	const todosPath = resolveEntry("pi-todos");
	devPaths = {
		extensionPaths: [webAccessPath, workflowPath, todosPath],
		skillPaths: [
			join(dirname(workflowPath), "skills"),
			join(dirname(todosPath), "skills"),
			...serverExtensions.flatMap(resolveExtensionSkillRoots),
		],
	};
	return devPaths;
}

const headlessSearchPolicy: ExtensionFactory = (pi: ExtensionAPI) => {
	pi.on("tool_call", (event) => {
		if (event.toolName !== "web_search") return;
		const input = event.input as Record<string, unknown>;
		if (input.workflow == null) input.workflow = "none";
	});
};

function isUnderPath(path: string, root: string): boolean {
	const normalizedPath = resolve(path);
	const normalizedRoot = resolve(root);
	return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${sep}`);
}

function relabelAliasProvenance(skill: Skill, sources: CompatibilitySkillSource[]): Skill {
	if (skill.sourceInfo.scope !== "temporary") return skill;
	const source = sources.find((candidate) => isUnderPath(skill.filePath, candidate.path));
	if (!source) return skill;
	return {
		...skill,
		sourceInfo: createSyntheticSourceInfo(skill.filePath, {
			source: source.provider,
			scope: source.scope,
			origin: "top-level",
			baseDir: source.path,
		}),
	};
}

function skillGroup(
	filePath: string,
	sources: CompatibilitySkillSource[],
	bundledPaths: string[],
): { group: string; isPlugin: boolean } {
	const source = sources.find((candidate) => isUnderPath(filePath, candidate.path));
	if (source?.plugin) return { group: source.plugin, isPlugin: true };
	if (source?.scope === "project") return { group: "project", isPlugin: false };
	if (source?.scope === "user") return { group: "personal", isPlugin: false };
	if (bundledPaths.some((path) => isUnderPath(filePath, path))) {
		return { group: "bundled", isPlugin: false };
	}
	return { group: "pi", isPlugin: false };
}

function skillsGate(cwd: string, bundledPaths: string[], getCtx: () => SkillAdmissionContext) {
	return (current: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
		const ctx = getCtx();
		const sources = discoverCompatibilitySkillSources(cwd);
		const projectAliasPaths = sources.filter((s) => s.scope === "project").map((s) => s.path);
		const isProjectAlias = (filePath: string) =>
			projectAliasPaths.some((path) => isUnderPath(filePath, path));
		return {
			...current,
			skills: current.skills
				.map((skill) => relabelAliasProvenance(skill, sources))
				.filter((skill) => {
					const { group, isPlugin } = skillGroup(skill.filePath, sources, bundledPaths);
					const projectNative = isUnderPath(skill.filePath, join(cwd, ".pi", "skills"));
					if (projectNative && !ctx.piResourceTrusted) return false;
					return (
						decideSkill(
							{ name: skill.name, isProjectAlias: isProjectAlias(skill.filePath), group, isPlugin },
							ctx,
						) === "load"
					);
				}),
		};
	};
}

function resolveSkillInputs(
	cwd: string,
	getCtx: () => SkillAdmissionContext,
): {
	additionalSkillPaths: string[];
	skillsOverride: ReturnType<typeof skillsGate>;
} {
	const candidates = candidateCompatibilitySkillRoots(cwd);
	const personal = candidates.filter((source) => source.scope === "user");
	const project = candidates.filter((source) => source.scope === "project");
	const bundledSkillPaths = bundled ? [bundled.skillsDir] : resolveDevPaths().skillPaths;
	return {
		additionalSkillPaths: [
			...bundledSkillPaths,
			...personal.map((source) => source.path),
			...project.map((source) => source.path),
		],
		skillsOverride: skillsGate(cwd, bundledSkillPaths, getCtx),
	};
}

export function toSkillCommands(skills: readonly Skill[]): SlashCommandInfo[] {
	return skills.map((skill) => ({
		name: `skill:${skill.name}`,
		description: skill.description,
		source: "skill" as const,
		sourceInfo: skill.sourceInfo,
	}));
}

let devWebAccessFactory: BundledExtensionFactory | undefined;
function webAccessFactory(): BundledExtensionFactory {
	if (bundled) return bundled.webAccessFactory;
	if (!devWebAccessFactory) {
		const require = createRequire(import.meta.url);
		const loaded: { default: BundledExtensionFactory } = require("pi-web-access/index.ts");
		devWebAccessFactory = loaded.default;
	}
	return devWebAccessFactory;
}

export function childBaseExtensionFactories(): InlineExtension[] {
	return [oversizedImageGuard];
}

export function childExtensionFactories(): InlineExtension[] {
	return [
		headlessSearchPolicy,
		webAccessFactory(),
		...registryInlineExtensions("childExtensions"),
		...pluginResourcesProvider().childFactories,
	];
}

export async function buildResourceLoader(
	cwd: string,
	settingsManager: SettingsManager,
	getAdmission: () => SkillAdmissionContext,
	excludedExtensionPaths: readonly string[] = [],
	extraFactories: InlineExtension[] = [],
	askUserQuestionWaiters: AskUserQuestionWaiters = createAskUserQuestionWaiters(),
): Promise<ResourceLoader> {
	let disabledAtReload = disabledExtensions();
	const isDisabledAtReload = (name: string): boolean => disabledAtReload.has(name);
	const pluginResources = pluginResourcesProvider();
	const sharedFactories: InlineExtension[] = [
		...registryInlineExtensions("extensions", isDisabledAtReload),
		headlessSearchPolicy,
		askUserQuestionExtension(askUserQuestionWaiters),
		reviewToolExtension,
		requestReviewExtension,
		setTitleExtension,
		oversizedImageGuard,
		pluginResources.toolsExtension,
		...pluginResources.factories,
		...extraFactories,
	];
	const skillInputs = resolveSkillInputs(cwd, getAdmission);
	const agentDir = getAgentDir();
	const common = {
		cwd,
		agentDir,
		settingsManager,
		...skillInputs,
		additionalSkillPaths: [...skillInputs.additionalSkillPaths, ...pluginResources.skillPaths],
		extensionFactories: [...(bundled?.factories ?? []), ...sharedFactories],
		extensionsOverride: (result: LoadExtensionsResult) =>
			omitDisabledRegistryExtensions(result, isDisabledAtReload),
	};
	const applyCurrentPolicy = (): void => {
		settingsManager.setProjectTrusted(getAdmission().piResourceTrusted);
		disabledAtReload = disabledExtensions();
	};

	const extensionFactories = [...(bundled?.factories ?? []), ...sharedFactories];
	const devExtensionPaths = bundled ? [] : resolveDevPaths().extensionPaths;
	const pluginExtensionPaths = pluginResources.extensionPaths;
	const excluded = new Set(excludedExtensionPaths.map((path) => resolve(path)));

	if (excluded.size === 0) {
		const loader = new DefaultResourceLoader({
			...common,
			additionalExtensionPaths: [...devExtensionPaths, ...pluginExtensionPaths],
		});
		const reload = loader.reload.bind(loader);
		loader.reload = async (options) => {
			applyCurrentPolicy();
			await reload(options);
		};
		await loader.reload();
		return loader;
	}

	const additionalExtensionPaths: string[] = [...devExtensionPaths, ...pluginExtensionPaths];
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir,
		settingsManager,
		builtinExtensions: builtinExtensionNames(extensionFactories),
	});
	let discoveredMetadata = new Map<string, PathMetadata>();
	const resolveExclusionPaths = async (): Promise<void> => {
		await settingsManager.reload();
		const resolved = await packageManager.resolve();
		const next: string[] = [];
		const metadata = new Map<string, PathMetadata>();
		for (const resource of resolved.extensions) {
			if (!resource.enabled) continue;
			if (resource.path.startsWith(BUILTIN_EXTENSION_PREFIX)) {
				next.push(resource.path);
				continue;
			}
			if (excluded.has(resolve(resource.path))) continue;
			next.push(resource.path);
			metadata.set(resolve(resource.path), resource.metadata);
		}
		additionalExtensionPaths.splice(
			0,
			additionalExtensionPaths.length,
			...devExtensionPaths,
			...pluginExtensionPaths,
			...next,
		);
		discoveredMetadata = metadata;
	};
	const loader = new DefaultResourceLoader({
		...common,
		noExtensions: true,
		additionalExtensionPaths,
	});
	const reload = loader.reload.bind(loader);
	loader.reload = async (options) => {
		applyCurrentPolicy();
		await resolveExclusionPaths();
		await reload(options);
		relabelDiscoveredExtensions(loader, discoveredMetadata);
	};
	await loader.reload();
	return loader;
}

const BUILTIN_EXTENSION_PREFIX = "builtin:";

function builtinExtensionNames(factories: readonly InlineExtension[]): string[] {
	return factories.flatMap((entry) =>
		typeof entry !== "function" && entry.builtin ? [entry.name] : [],
	);
}

function relabelDiscoveredExtensions(
	loader: ResourceLoader,
	discoveredMetadata: ReadonlyMap<string, PathMetadata>,
): void {
	for (const extension of loader.getExtensions().extensions) {
		const metadata = discoveredMetadata.get(resolve(extension.resolvedPath));
		if (!metadata) continue;
		extension.sourceInfo = createSyntheticSourceInfo(extension.path, metadata);
		for (const command of extension.commands.values()) command.sourceInfo = extension.sourceInfo;
		for (const tool of extension.tools.values()) tool.sourceInfo = extension.sourceInfo;
	}
}

export async function isBuiltinExtensionEnabled(
	cwd: string,
	projectTrusted: boolean,
	name: string,
): Promise<boolean> {
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir,
		settingsManager,
		builtinExtensions: [name],
	});
	const { extensions } = await packageManager.resolve(async () => "skip");
	return extensions.some((resource) => resource.path === `builtin:${name}` && resource.enabled);
}

function admissionCacheKey(cwd: string, ctx: SkillAdmissionContext): string {
	return JSON.stringify([
		cwd,
		ctx.trusted,
		ctx.piResourceTrusted,
		[...ctx.acknowledged].sort(),
		[...ctx.disabled].sort(),
		[...ctx.disabledGroups].sort(),
		Object.entries(ctx.overrides).sort(([a], [b]) => a.localeCompare(b)),
	]);
}

const SKILL_LIST_TTL_MS = 5_000;
const skillListCache = new Map<string, { at: number; value: SlashCommandInfo[] }>();

export async function listSkillCommands(
	cwd: string,
	admission: SkillAdmissionContext,
): Promise<SlashCommandInfo[]> {
	const cacheKey = admissionCacheKey(cwd, admission);
	const cached = skillListCache.get(cacheKey);
	if (cached && Date.now() - cached.at < SKILL_LIST_TTL_MS) return cached.value;
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: true });
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		...resolveSkillInputs(cwd, () => admission),
		noExtensions: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	const value = toSkillCommands(loader.getSkills().skills);
	skillListCache.set(cacheKey, { at: Date.now(), value });
	return value;
}

export async function listProjectAliasSkillNames(cwd: string): Promise<string[]> {
	const projectPaths = discoverCompatibilitySkillSources(cwd)
		.filter((source) => source.scope === "project")
		.map((source) => source.path);
	if (projectPaths.length === 0) return [];
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: true });
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		additionalSkillPaths: projectPaths,
		noExtensions: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	return loader
		.getSkills()
		.skills.filter((skill) => projectPaths.some((path) => isUnderPath(skill.filePath, path)))
		.map((skill) => skill.name);
}

export async function listSkillCatalog(
	cwd: string,
	admission: SkillAdmissionContext,
): Promise<SkillCatalogEntry[]> {
	const discovered = discoverCompatibilitySkillSources(cwd);
	const personal = discovered.filter((s) => s.scope === "user");
	const project = discovered.filter((s) => s.scope === "project");
	const bundledSkillPaths = bundled ? [bundled.skillsDir] : resolveDevPaths().skillPaths;
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: true });
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		additionalSkillPaths: [
			...bundledSkillPaths,
			...personal.map((s) => s.path),
			...project.map((s) => s.path),
		],
		skillsOverride: (current) => ({
			...current,
			skills: current.skills.map((skill) => relabelAliasProvenance(skill, discovered)),
		}),
		noExtensions: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	return loader.getSkills().skills.map((skill) => {
		const source = discovered.find((candidate) => isUnderPath(skill.filePath, candidate.path));
		const gated = source?.scope === "project";
		const { group, isPlugin } = skillGroup(skill.filePath, discovered, bundledSkillPaths);
		return {
			name: skill.name,
			description: skill.description,
			sourceInfo: skill.sourceInfo,
			gated,
			group,
			...(source?.plugin ? { plugin: source.plugin } : {}),
			decision: decideSkill(
				{ name: skill.name, isProjectAlias: gated, group, isPlugin },
				admission,
			),
		};
	});
}
