import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const APPEND_FILE_FLAG = "--append-system-prompt-file";

function isFile(path: string): boolean {
	return existsSync(path) && statSync(path).isFile();
}

export function appendedPromptFiles(command: string, cwd: string): string[] {
	const words = command.split(/\s+/).filter((word) => word !== "");
	const files: string[] = [];
	for (let index = 0; index < words.length; index++) {
		const word = words[index] ?? "";
		let head: string | null = null;
		if (word === APPEND_FILE_FLAG) head = "";
		else if (word.startsWith(`${APPEND_FILE_FLAG}=`))
			head = word.slice(APPEND_FILE_FLAG.length + 1);
		if (head === null) continue;
		const run: string[] = head === "" ? [] : [head];
		for (let next = index + 1; next <= words.length; next++) {
			if (run.length > 0) {
				const candidate = resolve(cwd, run.join(" "));
				if (isFile(candidate)) {
					if (!files.includes(candidate)) files.push(candidate);
					break;
				}
			}
			const following = words[next];
			if (following === undefined || following.startsWith("-")) break;
			run.push(following);
		}
	}
	return files;
}
