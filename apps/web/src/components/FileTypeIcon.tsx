import { type RemixiconComponentType, RiFileLine, RiFolderLine } from "@remixicon/react";
import { selectSlot, usePluginRegistry } from "@/plugins/registry";

/** The icon a file or directory wears — a plugin's `fileIcon` slot may override the default. */
export function FileTypeIcon({
	path,
	kind = "file",
	className,
	fallback,
}: {
	path: string;
	kind?: "file" | "directory";
	className?: string | undefined;
	/** The icon to wear when no plugin claims the path; the plain file or folder outline otherwise. */
	fallback?: RemixiconComponentType;
}) {
	const slots = usePluginRegistry((s) => selectSlot(s, "fileIcon"));
	for (const resolve of slots) {
		const Icon = resolve(path, kind);
		if (Icon) return <Icon {...(className !== undefined ? { className } : {})} />;
	}
	const Fallback = fallback ?? (kind === "directory" ? RiFolderLine : RiFileLine);
	return (
		<Fallback
			data-testid="file-type-icon"
			data-icon={kind === "directory" ? "folder" : "file"}
			className={className}
		/>
	);
}
