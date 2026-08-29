import {
	FILE_ICON_FALLBACK,
	FILE_ICONS_BY_EXTENSION,
	FILE_ICONS_BY_NAME,
} from "./fileIcons.generated";

/**
 * Which icon a path wears. The whole filename wins over an extension — `vitest.config.ts` is a Vitest
 * file, not a TypeScript one — and a longer extension wins over a shorter one, so `.d.ts` is not `.ts`.
 * See components/SPEC.md.
 */
export function fileIconName(path: string): string {
	const name = (path.split(/[\\/]/).pop() ?? path).toLowerCase();
	const byName = FILE_ICONS_BY_NAME[name];
	if (byName) return byName;

	const parts = name.split(".");
	for (let index = 1; index < parts.length; index += 1) {
		const byExtension = FILE_ICONS_BY_EXTENSION[parts.slice(index).join(".")];
		if (byExtension) return byExtension;
	}
	return FILE_ICON_FALLBACK;
}

export function fileIconUrl(name: string): string {
	return `${import.meta.env.BASE_URL}file-icons/${name}.svg`;
}
