import { RiFileLine, RiFolderLine } from "@remixicon/react";

export function FileTypeIcon({
	kind = "file",
	className,
}: {
	path: string;
	kind?: "file" | "directory";
	className?: string | undefined;
}) {
	const Fallback = kind === "directory" ? RiFolderLine : RiFileLine;
	return (
		<Fallback
			data-testid="file-type-icon"
			data-icon={kind === "directory" ? "folder" : "file"}
			className={className}
		/>
	);
}
