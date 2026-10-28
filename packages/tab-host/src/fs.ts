import { createFsFromVolume, type IFs, Volume } from "memfs";

/** The tab's whole filesystem: memfs, so every caller gets Node's sync, callback and promise API. */
export type TabFs = IFs;

export function createTabFs(): TabFs {
	return createFsFromVolume(new Volume());
}

export function normalizePath(path: string): string {
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
}

export function joinPath(...parts: string[]): string {
	return normalizePath(parts.join("/"));
}

export function dirnamePath(path: string): string {
	const normalized = normalizePath(path);
	const index = normalized.lastIndexOf("/");
	return index <= 0 ? "/" : normalized.slice(0, index);
}

export function basenamePath(path: string): string {
	const normalized = normalizePath(path);
	return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function isNotFound(error: unknown): boolean {
	return (error as { name?: string }).name === "NotFoundError";
}

async function loadInto(fs: TabFs, dir: FileSystemDirectoryHandle, path: string): Promise<void> {
	for await (const [name, handle] of (
		dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
	).entries()) {
		const child = joinPath(path, name);
		if (handle.kind === "directory") {
			fs.mkdirSync(child, { recursive: true });
			await loadInto(fs, handle as FileSystemDirectoryHandle, child);
		} else {
			const file = await (handle as FileSystemFileHandle).getFile();
			fs.writeFileSync(child, new Uint8Array(await file.arrayBuffer()));
		}
	}
}

type Snapshot = Map<string, string>;

function snapshot(fs: TabFs): Snapshot {
	const entries: Snapshot = new Map();
	const walk = (path: string) => {
		for (const name of fs.readdirSync(path) as string[]) {
			const child = joinPath(path, name);
			const stat = fs.statSync(child);
			if (stat.isDirectory()) {
				entries.set(child, "dir");
				walk(child);
			} else entries.set(child, `${stat.mtimeMs}:${stat.size}`);
		}
	};
	walk("/");
	return entries;
}

async function directoryFor(
	root: FileSystemDirectoryHandle,
	path: string,
	create: true,
): Promise<FileSystemDirectoryHandle>;
async function directoryFor(
	root: FileSystemDirectoryHandle,
	path: string,
	create: boolean,
): Promise<FileSystemDirectoryHandle | null>;
async function directoryFor(
	root: FileSystemDirectoryHandle,
	path: string,
	create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
	let current = root;
	for (const part of normalizePath(path).split("/").filter(Boolean)) {
		try {
			current = await current.getDirectoryHandle(part, { create });
		} catch (error) {
			if (isNotFound(error)) return null;
			throw error;
		}
	}
	return current;
}

/**
 * Keeps an OPFS directory a copy of the volume. `restore` fills the volume from the directory once;
 * `flush` writes what changed since the last flush, so a reload finds the same tree.
 */
export interface TabFsMirror {
	restore(): Promise<void>;
	flush(): Promise<void>;
}

export function createTabFsMirror(fs: TabFs, root: FileSystemDirectoryHandle): TabFsMirror {
	let synced: Snapshot = new Map();
	let running: Promise<void> = Promise.resolve();

	const write = async () => {
		const next = snapshot(fs);
		for (const [path, kind] of synced) {
			if (next.has(path) && (next.get(path) === "dir") === (kind === "dir")) continue;
			const parent = await directoryFor(root, dirnamePath(path), false);
			await parent?.removeEntry(basenamePath(path), { recursive: true }).catch((error) => {
				if (!isNotFound(error)) throw error;
			});
		}
		for (const [path, kind] of next) {
			if (synced.get(path) === kind) continue;
			if (kind === "dir") {
				await directoryFor(root, path, true);
				continue;
			}
			const parent = await directoryFor(root, dirnamePath(path), true);
			const handle = await parent.getFileHandle(basenamePath(path), { create: true });
			const writable = await handle.createWritable();
			await writable.write(fs.readFileSync(path) as Uint8Array<ArrayBuffer>);
			await writable.close();
		}
		synced = next;
	};

	return {
		async restore() {
			await loadInto(fs, root, "/");
			synced = snapshot(fs);
		},
		flush() {
			running = running.then(write, write);
			return running;
		},
	};
}
