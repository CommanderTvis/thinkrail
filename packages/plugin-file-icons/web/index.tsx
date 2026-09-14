import { RiFileLine } from "@remixicon/react";
import type { CoreSlots } from "@thinkrail/plugin-api/web";
import { definePluginWeb } from "@thinkrail/plugin-api/web";
import { SvgAsset } from "@thinkrail/plugin-ui";
import type { ComponentType } from "react";
import { fileIconName } from "./fileIcon";

/** One component per icon name, so a re-render resolves to the same identity and never remounts the SVG. */
export function createFileIconResolver(
	assetUrl: (path: string) => string,
): NonNullable<CoreSlots["fileIcon"]> {
	const components = new Map<string, ComponentType<{ className?: string }>>();
	return (path, kind) => {
		if (kind !== "file") return null;
		const name = fileIconName(path);
		let Icon = components.get(name);
		if (!Icon) {
			const url = assetUrl(`file-icons/${name}.svg`);
			Icon = ({ className }) => (
				<SvgAsset
					url={url}
					className={className}
					testid="file-type-icon"
					name={name}
					fallback={
						<RiFileLine data-testid="file-type-icon" data-icon="file" className={className} />
					}
				/>
			);
			components.set(name, Icon);
		}
		return Icon;
	};
}

export default definePluginWeb({
	activate(ctx) {
		ctx.slot(
			"fileIcon",
			createFileIconResolver((path) => ctx.assetUrl(path)),
		);
	},
});
