import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { builtinPluginAssets, TAB_HOST_NODE_SHIMS } from "@thinkrail/tab-host/build-support";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { posthogSourceMapUpload, sourceMapRelease } from "./sourceMapUpload";

const hostPort = process.env.THINKRAIL_PORT ?? 24242;

const TAB_HOST_SHIM_DIR = dirname(TAB_HOST_NODE_SHIMS["node:fs"] ?? "");

function playgroundPluginAssets(): Plugin {
	let outDir = "dist";
	return {
		name: "thinkrail-playground-plugin-assets",
		apply: "build",
		configResolved(config) {
			outDir = config.build.outDir;
		},
		closeBundle() {
			if (process.env.VITE_HOST_MODE !== "tab") return;
			for (const { id, dir } of builtinPluginAssets()) {
				cpSync(dir, join(outDir, "plugin", id, "assets"), { recursive: true });
			}
		},
	};
}

function tabHostNodeShims(): Plugin {
	return {
		name: "thinkrail-tab-host-node-shims",
		enforce: "pre",
		resolveId(source, importer) {
			const shim = TAB_HOST_NODE_SHIMS[source];
			return shim && !importer?.startsWith(TAB_HOST_SHIM_DIR) ? shim : null;
		},
	};
}

export default defineConfig(({ mode }) => {
	const profile = mode === "profile";
	const release = profile ? null : sourceMapRelease();
	return {
		base: process.env.VITE_BASE ?? "/",
		plugins: [
			react({ compiler: { sources: ["/apps/web/src/"] } }),
			tailwindcss(),
			...(release ? [posthogSourceMapUpload(release)] : []),
			{ ...tabHostNodeShims(), apply: "serve" },
			playgroundPluginAssets(),
		],
		resolve: {
			alias: [
				{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
				...(profile ? [{ find: /^react-dom\/client$/, replacement: "react-dom/profiling" }] : []),
			],
		},
		server: {
			port: Number(process.env.THINKRAIL_WEB_PORT ?? 24269),
			strictPort: process.env.THINKRAIL_WEB_PORT !== undefined,
			proxy: {
				"/ws": {
					target: `ws://localhost:${hostPort}`,
					ws: true,
				},
				"/plugin": { target: `http://localhost:${hostPort}` },
				"/files": { target: `http://localhost:${hostPort}` },
				"/blob": { target: `http://localhost:${hostPort}` },
			},
		},
		optimizeDeps: { rolldownOptions: { plugins: [tabHostNodeShims()] } },
		worker: { format: "es", plugins: () => [tabHostNodeShims()] },
		build: profile
			? { outDir: "dist-profile", minify: false }
			: { outDir: "dist", ...(release ? { sourcemap: "hidden" as const } : {}) },
	};
});
