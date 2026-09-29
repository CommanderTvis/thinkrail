import { RiFileLine, RiFolderLine } from "@remixicon/react";
import { selectSlot, usePluginRegistry } from "@/plugins/registry";

/** The icon a file or directory wears — a plugin's `fileIcon` slot may override the default. */
export function FileTypeIcon({
	path,
	kind = "file",
	className,
}: {
	path: string;
	kind?: "file" | "directory";
	className?: string | undefined;
}) {
	const slots = usePluginRegistry((s) => selectSlot(s, "fileIcon"));
	for (const resolve of slots) {
		const Icon = resolve(path, kind);
		if (Icon) return <Icon {...(className !== undefined ? { className } : {})} />;
	}
	const Fallback = kind === "directory" ? RiFolderLine : RiFileLine;
	return (
		<Fallback
			data-testid="file-type-icon"
			data-icon={kind === "directory" ? "folder" : "file"}
			className={className}
		/>
	);
}
