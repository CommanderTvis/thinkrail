import { join } from "node:path";

export const buildSupport = {
	id: "codex",
	assets: join(import.meta.dir, "assets"),
	pi: {
		extensions: [],
		skills: [],
	},
};
