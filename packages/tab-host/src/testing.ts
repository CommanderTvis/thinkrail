import { nodeToFsa } from "@jsonjoy.com/fs-node-to-fsa";
import { memfs } from "memfs";

export function memoryDirectory(): FileSystemDirectoryHandle {
	const { fs } = memfs({ "/root": null });
	return nodeToFsa(fs as never, "/root", {
		mode: "readwrite",
	}) as unknown as FileSystemDirectoryHandle;
}
