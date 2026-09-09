import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
const pinned = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")).devDependencies
	.electrobun;
const marker = join(desktop, ".hutch/devkit/.complete");
const prepared =
	existsSync(marker) && readFileSync(marker, "utf8").split("\n").includes(`electrobun=${pinned}`);

if (!prepared) {
	process.exit(
		spawnSync("electrobun", ["prepare"], { cwd: desktop, stdio: "inherit" }).status ?? 1,
	);
}
