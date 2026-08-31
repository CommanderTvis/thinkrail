#!/usr/bin/env bun

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseSubcommand } from "./args";
import {
	bundledExtensionFactories,
	bundledSkillsVersion,
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

const subcommand = parseSubcommand(Bun.argv.slice(2));
if (subcommand === "acp-pi") {
	const skillsDir = await stage("skills", bundledSkillsVersion, embeddedSkillFiles);
	const { registerBundledRuntime } = await import("@thinkrail/pi-agent");
	const [webAccessFactory] = bundledExtensionFactories;
	if (!webAccessFactory) throw new Error("bundled extensions are missing pi-web-access");
	await registerBundledRuntime({
		factories: bundledExtensionFactories,
		skillsDir,
		webAccessFactory,
	});
} else if (subcommand === undefined) {
	const staticDir = await stage("web", webAssetsVersion, embeddedWebAssets);
	const runtimeDir = await stage("runtime", runtimeAssetsVersion, embeddedRuntimeAssets);
	const macosTrash = join(runtimeDir, "macos-trash");
	const windowsTrash = join(runtimeDir, "windows-trash.exe");
	if (process.platform !== "win32") chmodSync(macosTrash, 0o755);
	process.env.THINKRAIL_STATIC_DIR ??= staticDir;
	const { setBundledTrashHelpers } = await import("@thinkrail/server");
	setBundledTrashHelpers({ macos: macosTrash, windows: windowsTrash });
}
const { launch } = await import("./bootstrap");
await launch("binary");
