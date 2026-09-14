#!/usr/bin/env bun

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseSubcommand } from "./args";
import {
	bundledExtensionFactories,
	bundledPluginAssetRoutes,
	bundledPluginFactories,
	bundledPluginRuntimeVersion,
	bundledPluginSkillRoutes,
	bundledSkillsVersion,
	bundledWebAccessFactory,
	embeddedPluginRuntimeFiles,
	embeddedSkillFiles,
} from "./bundled-extensions.generated";
import { stagingRoot } from "./paths";
import { embeddedRuntimeAssets, runtimeAssetsVersion } from "./runtime-assets.generated";
import { embeddedWebAssets, webAssetsVersion } from "./web-assets.generated";

async function stage(
	kind: string,
	version: string,
	files: { route: string; data: string }[],
): Promise<string> {
	const dir = join(stagingRoot(), kind, version);
	const marker = `${dir}.complete`;
	if (existsSync(marker)) return dir;
	await Promise.all(
		files.map(async (file) => {
			const dest = join(dir, file.route);
			mkdirSync(dirname(dest), { recursive: true });
			await Bun.write(dest, Bun.file(file.data));
		}),
	);
	await Bun.write(marker, version);
	return dir;
}

if (parseSubcommand(Bun.argv.slice(2)) === undefined) {
	const staticDir = await stage("web", webAssetsVersion, embeddedWebAssets);
	const skillsDir = await stage("skills", bundledSkillsVersion, embeddedSkillFiles);
	const runtimeDir = await stage("runtime", runtimeAssetsVersion, embeddedRuntimeAssets);
	const pluginsDir = await stage(
		"plugins",
		bundledPluginRuntimeVersion,
		embeddedPluginRuntimeFiles,
	);
	const macosTrash = join(runtimeDir, "macos-trash");
	const windowsTrash = join(runtimeDir, "windows-trash.exe");
	if (process.platform !== "win32") chmodSync(macosTrash, 0o755);
	process.env.THINKRAIL_STATIC_DIR ??= staticDir;
	const { registerBundledRuntime } = await import("@thinkrail/server");
	const plugins = Object.fromEntries(
		Object.entries(bundledPluginFactories).map(([id, factories]) => [
			id,
			{
				factories,
				skillsDir: bundledPluginSkillRoutes[id]
					? join(pluginsDir, bundledPluginSkillRoutes[id])
					: null,
				assetsDir: bundledPluginAssetRoutes[id]
					? join(pluginsDir, bundledPluginAssetRoutes[id])
					: null,
			},
		]),
	);
	await registerBundledRuntime({
		factories: bundledExtensionFactories,
		skillsDir,
		trashHelpers: { macos: macosTrash, windows: windowsTrash },
		webAccessFactory: bundledWebAccessFactory,
		plugins,
	});
}
const { launch } = await import("./bootstrap");
await launch("binary");
