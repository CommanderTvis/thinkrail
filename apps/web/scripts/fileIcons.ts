import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface IconSet {
	version: string;
	/** Icon name → the recoloured SVG that is served for it. */
	svgs: Map<string, string>;
	/** Lowercased extension (no dot) → icon name, longest first so `config.ts` beats `ts`. */
	extensions: Record<string, string>;
	/** Lowercased whole filename → icon name. */
	names: Record<string, string>;
	fallback: string;
}

interface MaterialManifest {
	fileExtensions: Record<string, string>;
	fileNames: Record<string, string>;
	iconDefinitions: Record<string, unknown>;
	file: string;
}

const COLOUR = /(fill|stroke|stop-color)="(#[0-9a-fA-F]{3,8})"/g;
const GRADIENT_REF = /(fill|stroke)="url\(#[^)]*\)"/g;
const DEFS = /<defs>[\s\S]*?<\/defs>/g;

function luminance(hex: string): number {
	const value = hex.slice(1);
	const full =
		value.length <= 4
			? [...value.slice(0, 3)].map((c) => Number.parseInt(c + c, 16))
			: [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
	const [r = 0, g = 0, b = 0] = full;
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Material's icons are one or two flat colours: a saturated primary and a pale accent. Both become the
 * theme's own colour, the paler one at reduced alpha, so the shape keeps its two-tone reading wherever it
 * is drawn. A gradient cannot be split that way and flattens to the primary. See panels/SPEC.md.
 */
export function monotone(svg: string): string {
	const colours = [...new Set([...svg.matchAll(COLOUR)].map((match) => match[2] as string))];
	const sorted = [...colours].sort((a, b) => luminance(a) - luminance(b));
	const median = sorted.length > 1 ? luminance(sorted[Math.floor(sorted.length / 2)] as string) : 1;
	const secondary = new Set(
		colours.filter((colour) => sorted.length > 1 && luminance(colour) >= median),
	);
	return svg
		.replace(DEFS, "")
		.replace(GRADIENT_REF, (_match, attribute: string) => `${attribute}="currentColor"`)
		.replace(
			COLOUR,
			(_match, attribute: string, colour: string) =>
				`${attribute}="currentColor"${secondary.has(colour) ? ` ${attribute}-opacity=".45"` : ""}`,
		);
}

export function loadIconSet(): IconSet {
	const packageJson = Bun.resolveSync("material-icon-theme/package.json", process.cwd());
	const root = dirname(packageJson);
	const version = (JSON.parse(readFileSync(packageJson, "utf8")) as { version: string }).version;
	const manifest = JSON.parse(
		readFileSync(join(root, "dist", "material-icons.json"), "utf8"),
	) as MaterialManifest;

	const iconsDir = join(root, "icons");
	const svgs = new Map<string, string>();
	for (const file of readdirSync(iconsDir)) {
		if (!file.endsWith(".svg")) continue;
		svgs.set(file.slice(0, -4), monotone(readFileSync(join(iconsDir, file), "utf8")).trim());
	}

	const lower = (source: Record<string, string>): Record<string, string> => {
		const out: Record<string, string> = {};
		for (const [key, icon] of Object.entries(source)) {
			if (svgs.has(icon)) out[key.toLowerCase()] = icon;
		}
		return out;
	};

	return {
		version,
		svgs,
		extensions: lower(manifest.fileExtensions),
		names: lower(manifest.fileNames),
		fallback: manifest.file,
	};
}
