import { RiSearchLine as SearchIcon } from "@remixicon/react";
import type { SearchHit } from "@thinkrail/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FileTypeIcon } from "../components/FileTypeIcon";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { splitPath } from "./changesModel";
import { openFileInTab } from "./openTabs";

const DEBOUNCE_MS = 200;

type Search =
	| { state: "idle" }
	| { state: "running" }
	| { state: "done"; hits: SearchHit[]; truncated: boolean };

function groupByFile(hits: readonly SearchHit[]): [string, SearchHit[]][] {
	const groups = new Map<string, SearchHit[]>();
	for (const hit of hits) {
		const bucket = groups.get(hit.path);
		if (bucket) bucket.push(hit);
		else groups.set(hit.path, [hit]);
	}
	return [...groups];
}

export function SearchOverlay({
	workspaceId,
	onClose,
}: {
	workspaceId: string;
	onClose: () => void;
}) {
	const [query, setQuery] = useState("");
	const [search, setSearch] = useState<Search>({ state: "idle" });
	const generation = useRef(0);
	const input = useRef<HTMLInputElement>(null);

	useEffect(() => {
		input.current?.focus();
	}, []);

	useEffect(() => {
		const trimmed = query.trim();
		if (trimmed.length === 0) {
			setSearch({ state: "idle" });
			return;
		}
		const mine = ++generation.current;
		setSearch({ state: "running" });
		const timer = setTimeout(() => {
			getTransport()
				.request("fs.search", { workspaceId, query: trimmed })
				.then((result) => {
					if (generation.current !== mine) return;
					setSearch({ state: "done", hits: result.hits, truncated: result.truncated });
				})
				.catch(() => {
					if (generation.current === mine) setSearch({ state: "done", hits: [], truncated: false });
				});
		}, DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, workspaceId]);

	const groups = useMemo(() => (search.state === "done" ? groupByFile(search.hits) : []), [search]);

	const open = (hit: SearchHit) => {
		onClose();
		void openFileInTab(workspaceId, hit.path, "keep").then(() =>
			useAppStore.getState().requestFileLineFocus(workspaceId, hit.path, hit.line),
		);
	};

	return (
		<Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
			<DialogContent
				data-testid="search-overlay"
				hideClose
				className="max-w-[40rem] gap-0 p-0"
				aria-describedby={undefined}
			>
				<DialogTitle className="sr-only">Search this workspace</DialogTitle>
				<div className="flex items-center gap-8 border-border-default border-b px-16 py-12">
					<SearchIcon className="size-16 shrink-0 text-text-muted" />
					<input
						ref={input}
						data-testid="search-query"
						aria-label="Search this workspace"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search this workspace"
						className="min-w-0 flex-1 bg-transparent text-text-default outline-none placeholder:text-text-subtle"
					/>
				</div>
				<div data-testid="search-results" className="max-h-[24rem] min-h-0 overflow-auto py-8">
					{search.state === "idle" ? null : search.state === "running" ? (
						<p className="px-16 py-8 text-text-muted">Searching…</p>
					) : groups.length === 0 ? (
						<p data-testid="search-empty" className="px-16 py-8 text-text-muted">
							No matches
						</p>
					) : (
						groups.map(([path, hits]) => (
							<div key={path} data-testid="search-file" data-path={path}>
								<div className="flex items-center gap-4 px-16 py-4 tr-text-metadata">
									<FileTypeIcon path={path} className="size-14 shrink-0" />
									<span className="truncate text-text-default">{splitPath(path).base}</span>
									<span className="truncate text-text-subtle">{splitPath(path).dir}</span>
								</div>
								{hits.map((hit) => (
									<button
										key={`${hit.line}:${hit.text}`}
										type="button"
										data-testid="search-hit"
										data-line={hit.line}
										onClick={() => open(hit)}
										className="flex w-full items-baseline gap-8 px-16 py-2 text-left tr-code-text hover:bg-control-bg-hovered"
									>
										<span className="w-32 shrink-0 text-right text-text-subtle">{hit.line}</span>
										<span className="truncate text-text-muted">{hit.text.trim()}</span>
									</button>
								))}
							</div>
						))
					)}
					{search.state === "done" && search.truncated ? (
						<p data-testid="search-truncated" className="px-16 py-8 text-text-subtle">
							First 200 matches — narrow the query to see the rest.
						</p>
					) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
