import { join } from "node:path";

export const buildSupport = {
	id: "file-icons",
	assets: join(import.meta.dir, "assets"),
	pi: {
		extensions: [],
		skills: [],
	},
};
