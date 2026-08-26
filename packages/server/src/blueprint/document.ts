import { readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

/**
 * The specification is a file the *agent* owns and writes with ordinary tools, at the root of the
 * worktree where it is obvious and committable. That is what lets the author be a visible, interactive
 * agent rather than a headless process nobody can talk to — see SPEC.md.
 */
import { BLUEPRINT_FILE, type BlueprintSource } from "@thinkrail/contracts";

export { BLUEPRINT_FILE };

export function blueprintPath(worktreePath: string): string {
	return join(worktreePath, BLUEPRINT_FILE);
}

export function readBlueprintFile(worktreePath: string): string | null {
	try {
		return readFileSync(blueprintPath(worktreePath), "utf8");
	} catch {
		return null;
	}
}

/**
 * A takeover reads something that is already there, so the path is checked before an agent is started on
 * it: inside this worktree, an existing file, and stored relative because that is what the prompt says
 * out loud. See SPEC.md.
 */
export function resolveBlueprintSource(
	worktreePath: string,
	source: BlueprintSource,
): BlueprintSource {
	if (source.kind === "idea") {
		const brief = source.brief.trim();
		if (!brief) throw new Error("Describe what you want to build first.");
		return { kind: "idea", brief };
	}
	if (source.kind === "product") return source;

	const root = resolve(worktreePath);
	const abs = resolve(root, source.path);
	const path = relative(root, abs);
	if (!path || path.startsWith("..") || isAbsolute(path)) {
		throw new Error("Choose a document inside this project.");
	}
	if (!statSync(abs, { throwIfNoEntry: false })?.isFile()) {
		throw new Error(`There is no file at ${path}.`);
	}
	return { kind: "spec", path };
}

export function writeBlueprintFile(worktreePath: string, text: string): void {
	writeFileSync(blueprintPath(worktreePath), text.endsWith("\n") ? text : `${text}\n`, "utf8");
}
