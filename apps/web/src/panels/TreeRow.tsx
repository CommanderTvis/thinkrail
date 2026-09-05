import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiFileFill,
	RiFileLine,
	RiFolderFill,
	RiFolderLine,
} from "@remixicon/react";
import type { DragEvent, MouseEvent, ReactNode, Ref } from "react";

export function TreeRow({
	ref,
	testid,
	kind,
	expanded,
	active,
	subtle = false,
	dataStatus,
	dataViewed,
	label,
	muted,
	labelClassName,
	trailing,
	highlight = "self",
	onClick,
	onDoubleClick,
	onContextMenu,
	onWarm,
	onDragStart,
}: {
	ref?: Ref<HTMLButtonElement> | undefined;
	testid: string;
	kind: "dir" | "file";
	expanded?: boolean;
	active?: boolean;
	subtle?: boolean;
	dataStatus?: string | undefined;
	dataViewed?: boolean;
	label: string;
	muted?: string;
	labelClassName?: string;
	trailing?: ReactNode;
	highlight?: "self" | "wrapper";
	onClick?: ((event: MouseEvent) => void) | undefined;
	onDoubleClick?: (() => void) | undefined;
	onContextMenu?: ((event: MouseEvent) => void) | undefined;
	onWarm?: ((trigger: "hover" | "focus") => void) | undefined;
	onDragStart?: ((event: DragEvent) => void) | undefined;
}) {
	const Chevron = expanded ? ChevronDown : ChevronRight;
	const Folder = active ? RiFolderFill : RiFolderLine;
	const FileIcon = active ? RiFileFill : RiFileLine;
	const tone = subtle ? "text-text-subtle" : "text-text-muted";
	return (
		<button
			ref={ref}
			type="button"
			data-testid={testid}
			data-kind={kind}
			data-active={active ? true : undefined}
			data-status={dataStatus}
			data-viewed={dataViewed ? true : undefined}
			data-muted={muted ? true : undefined}
			title={muted}
			onClick={onClick}
			onDoubleClick={onDoubleClick}
			onContextMenu={onContextMenu}
			onPointerEnter={onWarm && (() => onWarm("hover"))}
			onFocus={onWarm && (() => onWarm("focus"))}
			draggable={onDragStart ? true : undefined}
			onDragStart={onDragStart}
			className={`flex h-panel-row w-full min-w-0 items-center gap-4 rounded-sm px-4 text-left tr-text-ui ${tone} outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
				highlight === "self"
					? `hover:bg-control-bg-hovered ${active ? "bg-control-bg-selected" : ""}`
					: ""
			}`}
		>
			{kind === "dir" ? (
				<Chevron className={`size-16 shrink-0 ${tone}`} />
			) : (
				<span className="size-14 shrink-0" />
			)}
			<span className="flex min-w-0 flex-1 items-center gap-4">
				{kind === "dir" ? (
					<Folder className={`size-14 shrink-0 ${tone}`} />
				) : (
					<FileIcon className={`size-14 shrink-0 ${tone}`} />
				)}
				<span
					className={`min-w-0 flex-1 truncate ${muted ? "text-text-subtle italic" : ""} ${labelClassName ?? ""}`}
				>
					{label}
				</span>
			</span>
			{trailing}
		</button>
	);
}
