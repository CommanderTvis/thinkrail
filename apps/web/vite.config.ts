import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const hostPort = process.env.THINKRAIL_PORT ?? 24242;

export default defineConfig(({ mode }) => {
	const profile = mode === "profile";
	return {
		plugins: [react({ compiler: { sources: ["/apps/web/src/"] } }), tailwindcss()],
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
		worker: { format: "es" },
		build: profile ? { outDir: "dist-profile", minify: false } : { outDir: "dist" },
	};
});
