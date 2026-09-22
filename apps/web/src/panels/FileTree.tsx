import {
	RiClipboardLine as Clipboard,
	RiFileAddLine as FileAdd,
	RiFolderAddLine as FolderAdd,
	RiFolderOpenLine as FolderOpen,
	RiEditLine as Rename,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { FileNode } from "@thinkrail/contracts";
import { useRef, useState } from "react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { absoluteWorkspacePath, startFileDrag } from "@/lib";
import { copyText } from "@/lib/utils";
import { LoadingRegion } from "../components/Skeleton";
import { selectWorkspaceById, type TabIntent, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { type ResolvedFolderChain, resolveFolderChain } from "./folderChains";
import { openFileInTab } from "./openTabs";
import { PathNameDialog } from "./PathNameDialog";
import { TreeRow } from "./TreeRow";
import { useWorkspaceRead } from "./useWorkspaceRead";

type SetPathsExpanded = (paths: readonly string[], expanded: boolean) => void;

function parentOf(path: string): string {
	return path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"), 0));
}

function childPath(parent: string, name: string): string {
	return parent === "" || parent === "." ? name : `${parent}/${name}`;
}

/** Each platform's file manager has its own name, and the wrong one reads as a bug. */
const REVEAL_LABEL =
	typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
		? "Reveal in Finder"
		: /Win/i.test(navigator.platform)
			? "Show in Explorer"
			: "Show in file manager";

export function FileTree({ workspaceId }: { workspaceId: string }) {
	const [nodes, setNodes] = useState<FileNode[] | null>(null);
	const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());
	const worktreePath = useAppStore(
		(state) => selectWorkspaceById(state, workspaceId)?.worktreePath,
	);

	const setPathsExpanded: SetPathsExpanded = (paths, expanded) => {
		setExpandedPaths((current) => {
			const next = new Set(current);
			for (const path of paths) {
				if (expanded) next.add(path);
				else next.delete(path);
			}
			return next;
		});
	};

	useWorkspaceRead(
		workspaceId,
		(id) => getTransport().request("fs.readDir", { workspaceId: id, path: "." }),
		{
			onResult: (result) => setNodes(result),
			onFailure: () => setNodes((prev) => prev ?? []),
			onSwitch: () => setNodes(null),
		},
	);

	if (nodes === null) return <LoadingRegion rows={8} className="px-4 py-4" />;
	if (nodes.length === 0)
		return <p className="px-4 py-4 tr-text-metadata text-text-muted">Empty</p>;
	return (
		<ul className="flex flex-col motion-safe:animate-reveal">
			{nodes.map((node) => (
				<FileNodeRow
					key={node.path}
					node={node}
					siblings={nodes}
					workspaceId={workspaceId}
					worktreePath={worktreePath}
					expandedPaths={expandedPaths}
					setPathsExpanded={setPathsExpanded}
				/>
			))}
		</ul>
	);
}

function FileNodeRow({
	node,
	siblings,
	workspaceId,
	worktreePath,
	expandedPaths,
	setPathsExpanded,
}: {
	node: FileNode;
	siblings: readonly FileNode[];
	workspaceId: string;
	worktreePath: string | undefined;
	expandedPaths: ReadonlySet<string>;
	setPathsExpanded: SetPathsExpanded;
}) {
	const isDir = node.kind === "dir";
	const [directory, setDirectory] = useState<ResolvedFolderChain<FileNode> | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [naming, setNamingState] = useState<"file" | "dir" | "rename" | null>(null);
	const namingFromMenu = useRef(false);
	const setNaming = (next: "file" | "dir" | "rename" | null) => {
		namingFromMenu.current = next !== null;
		setNamingState(next);
	};
	const pendingExpand = useRef(false);

	const { reload } = useWorkspaceRead(
		isDir ? workspaceId : null,
		(id) =>
			resolveFolderChain(node, (path) =>
				getTransport().request("fs.readDir", { workspaceId: id, path }),
			),
		{
			onResult: (result) => {
				setDirectory(result);
				if (!pendingExpand.current) return;
				pendingExpand.current = false;
				setPathsExpanded(result.paths, true);
			},
			onSwitch: () => {
				pendingExpand.current = false;
				setDirectory(null);
			},
		},
	);

	const label = directory?.label ?? node.name;
	const representedPaths = directory?.paths ?? [node.path];
	const representedPath = directory?.path ?? node.path;
	const expanded = expandedPaths.has(representedPath);
	const children = directory?.children ?? null;
	const nameExists = (name: string) =>
		(naming === "rename" || !isDir ? siblings : (children ?? [])).some(
			(entry) => entry.name === name,
		);
	const toggleDirectory = () => {
		const nextExpanded = !expanded;
		pendingExpand.current = nextExpanded && directory === null;
		setPathsExpanded(representedPaths, nextExpanded);
		if (nextExpanded) reload();
	};
	const open = (intent: TabIntent) => void openFileInTab(workspaceId, node.path, intent);
	const create = async (kind: "file" | "dir", name: string) => {
		const path = childPath(isDir ? (directory?.path ?? node.path) : parentOf(node.path), name);
		await getTransport().request("fs.createPath", { workspaceId, path, kind });
		setNaming(null);
		if (isDir && !expanded) toggleDirectory();
		if (kind === "file") void openFileInTab(workspaceId, path, "keep");
	};
	const rename = async (name: string) => {
		await getTransport().request("fs.renamePath", {
			workspaceId,
			path: node.path,
			to: childPath(parentOf(node.path), name),
		});
		setNaming(null);
	};

	return (
		<li>
			{/* Without a menu of our own the webview shows its native one, whose "Show in Finder" is about
			    downloads and does nothing for a workspace file. See panels/SPEC.md. */}
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div>
						<TreeRow
							testid="file-node"
							kind={isDir ? "dir" : "file"}
							expanded={expanded}
							label={label}
							muted={node.gitignored ? "Ignored by git" : undefined}
							onDragStart={(event) =>
								startFileDrag(event.dataTransfer, {
									path: directory?.path ?? node.path,
									kind: isDir ? "dir" : "file",
								})
							}
							onClick={isDir ? toggleDirectory : () => open("preview")}
							onDoubleClick={isDir ? undefined : () => open("keep")}
						/>
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent
					data-testid="file-node-actions"
					onCloseAutoFocus={(event) => {
						// The name dialog owns focus; handing it back to the row would reselect the whole name.
						if (namingFromMenu.current) event.preventDefault();
					}}
				>
					<ContextMenuItem data-testid="file-node-new-file" onSelect={() => setNaming("file")}>
						<FileAdd />
						New file…
					</ContextMenuItem>
					<ContextMenuItem data-testid="file-node-new-folder" onSelect={() => setNaming("dir")}>
						<FolderAdd />
						New folder…
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						data-testid="file-node-reveal"
						onSelect={() => {
							void getTransport()
								.request("fs.revealPath", { workspaceId, path: node.path })
								.catch(() => {});
						}}
					>
						<FolderOpen />
						{REVEAL_LABEL}
					</ContextMenuItem>
					<ContextMenuItem
						data-testid="file-node-copy-path"
						onSelect={() => {
							void copyText(node.path);
						}}
					>
						<Clipboard />
						Copy path
					</ContextMenuItem>
					{worktreePath && (
						<ContextMenuItem
							data-testid="file-node-copy-absolute-path"
							onSelect={() => void copyText(absoluteWorkspacePath(worktreePath, representedPath))}
						>
							<Clipboard />
							Copy absolute path
						</ContextMenuItem>
					)}
					<ContextMenuItem data-testid="file-node-rename" onSelect={() => setNaming("rename")}>
						<Rename />
						Rename…
					</ContextMenuItem>
					<ContextMenuItem data-testid="file-node-delete" onSelect={() => setConfirmDelete(true)}>
						<Trash2 />
						{isDir ? "Delete folder" : "Delete file"}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			{naming === "rename" ? (
				<PathNameDialog
					title={`Rename ${node.name}`}
					kind={isDir ? "dir" : "file"}
					initialName={node.name}
					confirmLabel="Rename"
					nameExists={nameExists}
					onCancel={() => setNaming(null)}
					onSubmit={rename}
				/>
			) : naming ? (
				<PathNameDialog
					title={naming === "dir" ? "New folder" : "New file"}
					kind={naming}
					confirmLabel="Create"
					nameExists={nameExists}
					onCancel={() => setNaming(null)}
					onSubmit={(name) => create(naming, name)}
				/>
			) : null}
			<ConfirmDialog
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title={`Delete ${label}?`}
				description={
					isDir
						? "The folder and everything in it move to the trash."
						: "The file moves to the trash."
				}
				confirmLabel="Delete"
				destructive
				confirmTestId="file-node-delete-confirm"
				onConfirm={() => {
					setConfirmDelete(false);
					void getTransport()
						.request("fs.trashPath", { workspaceId, path: node.path })
						.catch((err) => toast.error(errorText(err, `Couldn't delete ${label}`)));
				}}
			/>
			{isDir && expanded && children && (
				<ul className="flex flex-col pl-12">
					{children.map((child) => (
						<FileNodeRow
							key={child.path}
							node={child}
							siblings={children}
							workspaceId={workspaceId}
							worktreePath={worktreePath}
							expandedPaths={expandedPaths}
							setPathsExpanded={setPathsExpanded}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
