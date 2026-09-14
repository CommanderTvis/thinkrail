import { join } from "node:path";

export const buildSupport = {
	id: "claude-code",
	assets: join(import.meta.dir, "assets"),
	pi: {
		extensions: [],
		skills: [],
	},
};
