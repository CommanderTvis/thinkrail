import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { asRecord } from "../translate";
import type { FrameRecord } from "./frames";

export interface FixtureCorpus {
	name: string;
	records: FrameRecord[];
}

export const FIXTURES_DIR = resolve(new URL("fixtures", import.meta.url).pathname);

function toRecords(name: string, contents: string): FrameRecord[] {
	const parsed: unknown = JSON.parse(contents);
	if (!Array.isArray(parsed)) throw new Error(`fixture ${name} is not an array of frames`);
	return parsed.map((entry, index) => {
		const line = asRecord(entry);
		const direction = line?.direction;
		const frame = asRecord(line?.frame);
		if (frame === undefined || (direction !== "in" && direction !== "out")) {
			throw new Error(`fixture ${name} frame ${index} needs a direction and a frame object`);
		}
		return { at: index, direction, raw: JSON.stringify(frame) };
	});
}

export function loadFixtures(dir: string = FIXTURES_DIR): FixtureCorpus[] {
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => ({ name, records: toRecords(name, readFileSync(join(dir, name), "utf8")) }));
}
