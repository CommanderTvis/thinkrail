import { afterAll, beforeAll, expect, test } from "bun:test";
import { createTabFs } from "./fs";
import { NODE_RISK_NOTICE } from "./nodeCommands";
import { createShell } from "./shell";

function tar(files: Record<string, string>): Uint8Array<ArrayBuffer> {
	const encoder = new TextEncoder();
	const blocks: Uint8Array[] = [];
	for (const [name, content] of Object.entries(files)) {
		const body = encoder.encode(content);
		const header = new Uint8Array(512);
		header.set(encoder.encode(name), 0);
		header.set(encoder.encode("0000644\0"), 100);
		header.set(encoder.encode(`${body.length.toString(8).padStart(11, "0")}\0`), 124);
		header.set(encoder.encode("0"), 156);
		header.set(encoder.encode("ustar\0"), 257);
		blocks.push(header, body, new Uint8Array((512 - (body.length % 512)) % 512));
	}
	blocks.push(new Uint8Array(1024));
	const out = new Uint8Array(blocks.reduce((sum, block) => sum + block.length, 0));
	let offset = 0;
	for (const block of blocks) {
		out.set(block, offset);
		offset += block.length;
	}
	return out;
}

const PACKAGES: Record<
	string,
	{ version: string; files: Record<string, string>; dependencies?: Record<string, string> }
> = {
	"left-pad-ish": {
		version: "1.2.0",
		files: {
			"package/package.json": JSON.stringify({
				name: "left-pad-ish",
				version: "1.2.0",
				main: "index.js",
				bin: { pad: "bin/pad.js" },
				dependencies: { "repeat-ish": "^2.0.0" },
			}),
			"package/index.js":
				"const repeat = require('repeat-ish').default;\nmodule.exports = (s, n) => repeat(' ', n - s.length) + s;\n",
			"package/bin/pad.js":
				"#!/usr/bin/env node\nconst pad = require('..');\nconsole.log('[' + pad(process.argv[2], 5) + ']');\n",
		},
		dependencies: { "repeat-ish": "^2.0.0" },
	},
	"repeat-ish": {
		version: "2.1.0",
		files: {
			"package/package.json": JSON.stringify({
				name: "repeat-ish",
				version: "2.1.0",
				type: "module",
				exports: "./index.js",
			}),
			"package/index.js":
				"export default function repeat(s, n) { return n > 0 ? s.repeat(n) : ''; }\n",
		},
	},
};

let server: ReturnType<typeof Bun.serve>;
let registry = "";

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			const name = decodeURIComponent(url.pathname.slice(1));
			if (name.endsWith(".tgz")) {
				const pkg = PACKAGES[name.replace(/-\d+\.\d+\.\d+\.tgz$/, "")];
				return pkg
					? new Response(Bun.gzipSync(tar(pkg.files)))
					: new Response("missing", { status: 404 });
			}
			const pkg = PACKAGES[name];
			if (!pkg) return new Response("{}", { status: 404 });
			return Response.json({
				name,
				"dist-tags": { latest: pkg.version },
				versions: {
					[pkg.version]: {
						name,
						version: pkg.version,
						dependencies: pkg.dependencies ?? {},
						bin: name === "left-pad-ish" ? { pad: "bin/pad.js" } : undefined,
						dist: { tarball: `${registry}/${name}-${pkg.version}.tgz` },
					},
				},
			});
		},
	});
	registry = `http://localhost:${server.port}`;
});

afterAll(() => {
	server.stop(true);
});

function project() {
	const fs = createTabFs();
	fs.mkdirSync("/projects/app/src", { recursive: true });
	return { fs, shell: createShell(fs, "/projects/app") };
}

test("node runs scripts that require, import ESM and TypeScript, and writes files back", async () => {
	const { fs, shell } = project();
	fs.writeFileSync("/projects/app/src/util.mjs", "export const twice = (n) => n * 2;\n");
	fs.writeFileSync("/projects/app/src/types.ts", "export const label: string = 'typed';\n");
	fs.writeFileSync(
		"/projects/app/src/main.js",
		[
			"const fs = require('fs');",
			"const path = require('node:path');",
			"const { twice } = require('./util.mjs');",
			"const { label } = require('./types.ts');",
			"fs.writeFileSync(path.join(__dirname, 'out.txt'), String(twice(21)) + ' ' + label);",
			"fs.writeFileSync('/tmp/scratch.txt', 'tmp works');",
			"console.log(fs.readFileSync('/tmp/scratch.txt', 'utf8'), process.argv.slice(2).join(','));",
		].join("\n"),
	);
	const result = await shell.exec("node src/main.js a b", { cwd: "/projects/app" });
	expect(result.stdout).toBe("tmp works a,b\n");
	expect(result.stderr).toBe(`${NODE_RISK_NOTICE}\n`);
	expect(result.exitCode).toBe(0);
	expect(fs.readFileSync("/projects/app/src/out.txt", "utf8")).toBe("42 typed");

	const again = await shell.exec("node -p '1 + 2' && node -e 'process.exit(3)'", {
		cwd: "/projects/app",
	});
	expect(again.stdout).toBe("3\n");
	expect(again.exitCode).toBe(3);
	expect(again.stderr).toBe("");
});

test("npm install resolves from the registry, writes package.json, and npx runs the bin", async () => {
	const { fs, shell } = project();
	await shell.exec("npm init -y", { cwd: "/projects/app" });
	const env = { npm_config_registry: registry };
	const install = await shell.exec("npm install left-pad-ish", { cwd: "/projects/app", env });
	expect(install.stdout).toContain("added 2 packages");
	expect(
		JSON.parse(fs.readFileSync("/projects/app/package.json", "utf8") as string).dependencies,
	).toEqual({
		"left-pad-ish": "^1.2.0",
	});
	expect(fs.existsSync("/projects/app/node_modules/repeat-ish/index.js")).toBe(true);

	const run = await shell.exec("npx pad ab", { cwd: "/projects/app", env });
	expect(run.stderr).toBe("");
	expect(run.stdout).toBe("[   ab]\n");
	const required = await shell.exec("node -p \"require('left-pad-ish')('x', 3)\"", {
		cwd: "/projects/app",
	});
	expect(required.stdout).toBe("  x\n");
});

test("an npm: alias installs the real package under the alias's name", async () => {
	const { fs, shell } = project();
	fs.writeFileSync(
		"/projects/app/package.json",
		JSON.stringify({ name: "app", dependencies: { "repeat-alias": "npm:repeat-ish@^2.0.0" } }),
	);
	const result = await shell.exec("npm install", {
		cwd: "/projects/app",
		env: { npm_config_registry: registry },
	});
	expect(result.exitCode).toBe(0);
	expect(
		JSON.parse(
			fs.readFileSync("/projects/app/node_modules/repeat-alias/package.json", "utf8") as string,
		).name,
	).toBe("repeat-ish");
});
