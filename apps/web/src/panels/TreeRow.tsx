import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiFolderFill,
	RiFolderLine,
} from "@remixicon/react";
import type { MouseEvent, ReactNode } from "react";
import { FileTypeIcon } from "@/components/FileTypeIcon";

export function TreeRow({
	testid,
	kind,
	expanded,
	active,
	dataStatus,
	label,
	iconPath,
	labelClassName,
	trailing,
	highlight = "self",
	muted,
	onClick,
	onDoubleClick,
	onContextMenu,
}: {
	testid: string;
	kind: "dir" | "file";
	expanded?: boolean;
	active?: boolean;
	dataStatus?: string;
	label: string;
	/** What the icon is chosen from, when the row's label is not the file's own name. */
	iconPath?: string;
	labelClassName?: string;
	trailing?: ReactNode;
	highlight?: "self" | "wrapper";
	muted?: string | undefined;
	onClick?: (() => void) | undefined;
	onDoubleClick?: (() => void) | undefined;
	onContextMenu?: ((event: MouseEvent) => void) | undefined;
}) {
	const Chevron = expanded ? ChevronDown : ChevronRight;
	const Folder = active ? RiFolderFill : RiFolderLine;
	return (
		<button
			type="button"
			data-testid={testid}
			data-kind={kind}
			data-active={active ? true : undefined}
			data-status={dataStatus}
			data-muted={muted ? true : undefined}
			title={muted}
			onClick={onClick}
			onDoubleClick={onDoubleClick}
			onContextMenu={onContextMenu}
			className={`flex h-24 w-full min-w-0 items-center gap-4 rounded-[var(--radius-sm)] px-4 text-left tr-text-ui text-text-muted ${
				highlight === "self"
					? `hover:bg-control-bg-hovered ${active ? "bg-control-bg-selected" : ""}`
					: ""
			}`}
		>
			{kind === "dir" ? (
				<Chevron className="size-16 shrink-0 text-text-muted" />
			) : (
				<span className="size-14 shrink-0" />
			)}
			<span className="flex min-w-0 flex-1 items-center gap-4">
				{kind === "dir" ? (
					<Folder className="size-14 shrink-0 text-text-muted" />
				) : (
					<FileTypeIcon path={iconPath ?? label} className="size-14 text-text-muted" />
				)}
				<span
					className={`min-w-0 flex-1 truncate ${muted ? "text-text-subtle" : ""} ${labelClassName ?? ""}`}
				>
					{label}
				</span>
			</span>
			{trailing}
		</button>
	);
}
