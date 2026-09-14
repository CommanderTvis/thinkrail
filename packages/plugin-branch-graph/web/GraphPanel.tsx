import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { branchGraphContract, GitGraphWorktree } from "../contracts";
import { type GraphRow, type LaneState, layoutGraph } from "./graphLanes";

type Ctx = PluginWebContext<typeof branchGraphContract>;

const LANE_WIDTH = 14;
const ROW_HEIGHT = 40;
/** Rows kept beyond each edge of the viewport, so a fast scroll never shows the gap it opens. */
const OVERSCAN = 12;
/** The radius every corner turns through, so one turn looks like every other. */
const TURN = LANE_WIDTH / 2;

function Lanes({
	row,
	drawn,
	shown,
	marked,
}: {
	row: GraphRow;
	drawn: number;
	shown: number;
	marked: boolean;
}) {
	const width = drawn * LANE_WIDTH;
	const centre = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;
	const middle = ROW_HEIGHT / 2;
	// Every turn is the same quarter of the same circle, whatever distance the line covers: a fan of
	// merges then reads as one comb rather than a splay of different curvatures. See SPEC.md.
	const arriving = (from: number, to: number) => {
		const [x, y] = [centre(from), centre(to)];
		const step = Math.sign(y - x) * Math.min(TURN, Math.abs(y - x));
		return `M ${x} 0 V ${middle - TURN} Q ${x} ${middle} ${x + step} ${middle} L ${y} ${middle}`;
	};
	const leaving = (from: number, to: number) => {
		const [x, y] = [centre(from), centre(to)];
		const step = Math.sign(y - x) * Math.min(TURN, Math.abs(y - x));
		return `M ${x} ${middle} L ${y - step} ${middle} Q ${y} ${middle} ${y} ${middle + TURN} V ${ROW_HEIGHT}`;
	};
	return (
		// The gutter is as wide as the lanes on screen need, and slides when that changes — see SPEC.md.
		<span
			data-testid="graph-lanes"
			className="block shrink-0 overflow-hidden motion-safe:[transition:width_var(--transition-fast)]"
			style={{ width: shown * LANE_WIDTH }}
		>
			<svg
				aria-hidden="true"
				className="text-text-subtle"
				width={width}
				height={ROW_HEIGHT}
				viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
			>
				{row.fromAbove ? (
					<path
						d={`M ${centre(row.lane)} 0 V ${ROW_HEIGHT / 2}`}
						stroke="currentColor"
						strokeWidth="1.5"
						fill="none"
					/>
				) : null}
				{row.toBelow ? (
					<path
						d={`M ${centre(row.lane)} ${ROW_HEIGHT / 2} V ${ROW_HEIGHT}`}
						stroke="currentColor"
						strokeWidth="1.5"
						fill="none"
					/>
				) : null}
				{row.branches.map((branch) => (
					<path
						key={`branch:${branch}`}
						data-testid="graph-branch"
						d={leaving(row.lane, branch)}
						stroke="currentColor"
						strokeWidth="1.5"
						fill="none"
					/>
				))}
				{row.edges.map((edge) => (
					<path
						key={`${edge.lane}:${edge.joins ?? "through"}`}
						d={
							edge.joins === null
								? `M ${centre(edge.lane)} 0 V ${ROW_HEIGHT}`
								: arriving(edge.lane, edge.joins)
						}
						stroke="currentColor"
						strokeWidth="1.5"
						fill="none"
					/>
				))}
				<circle
					cx={centre(row.lane)}
					cy={ROW_HEIGHT / 2}
					r={marked ? 4.5 : 3.5}
					className={marked ? "fill-primary" : "fill-text-subtle"}
				/>
			</svg>
		</span>
	);
}

interface History {
	rows: GraphRow[];
	carry: LaneState;
	worktrees: GitGraphWorktree[];
	hasMore: boolean;
	revision: number;
}

const EMPTY: History = { rows: [], carry: [], worktrees: [], hasMore: false, revision: 0 };

export function createGraphPanel(ctx: Ctx) {
	return function GraphPanel({ workspaceId }: { workspaceId: string }) {
		const projectId = ctx.useHost((h) => h.contextProjectId);
		const [history, setHistory] = useState<History | null>(null);
		const [error, setError] = useState<string | null>(null);
		const [window, setWindow] = useState({ top: 0, height: 0 });
		const reading = useRef(false);
		const host = useRef<HTMLDivElement>(null);
		const tick = ctx.useHost((h) => h.workspaceRevisions[workspaceId] ?? 0);

		const read = useCallback(
			(previous: History | null) => {
				if (!projectId || reading.current) return;
				reading.current = true;
				ctx
					.request("graph", { projectId, skip: previous?.rows.length ?? 0 })
					.then((page) => {
						const { rows, carry } = layoutGraph(page.commits, previous?.carry ?? []);
						setHistory({
							rows: [...(previous?.rows ?? []), ...rows],
							carry,
							worktrees: previous ? previous.worktrees : page.worktrees,
							hasMore: page.hasMore,
							revision: tick,
						});
					})
					.catch(() => setError("Could not read the history."))
					.finally(() => {
						reading.current = false;
					});
			},
			[projectId, tick],
		);

		const [shownProject, setShownProject] = useState(projectId);
		if (shownProject !== projectId) {
			setShownProject(projectId);
			setHistory(null);
			setError(null);
		}

		// A write in the worktree can move any ref, so the history is read again from its tip — in place,
		// because tearing the list down would throw the reader back to the top mid-scroll. See SPEC.md.
		useEffect(() => {
			reading.current = false;
			read(null);
		}, [read]);

		const marks = useMemo(() => {
			const byS = new Map<string, string[]>();
			for (const tree of history?.worktrees ?? []) {
				const at = byS.get(tree.sha);
				if (at) at.push(tree.name);
				else byS.set(tree.sha, [tree.name]);
			}
			return byS;
		}, [history]);

		const { rows, hasMore } = history ?? EMPTY;

		// Bound to whatever actually scrolls this panel — the group's own body, not a scroller of our own.
		// A scroll event does not bubble, so it has to be the element itself. See SPEC.md.
		useEffect(() => {
			let viewport = host.current?.parentElement ?? null;
			while (viewport) {
				const overflow = getComputedStyle(viewport).overflowY;
				if (overflow === "auto" || overflow === "scroll") break;
				viewport = viewport.parentElement;
			}
			if (!viewport) return;
			const onScroll = () => {
				setWindow({ top: viewport.scrollTop, height: viewport.clientHeight });
				const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
				if (hasMore && remaining < ROW_HEIGHT * OVERSCAN) read(history);
			};
			onScroll();
			viewport.addEventListener("scroll", onScroll, { passive: true });
			return () => viewport.removeEventListener("scroll", onScroll);
		}, [hasMore, history, read]);

		// Drawn at the width the whole read can need, so a row never has to be redrawn to widen.
		const drawnLanes = useMemo(
			() => rows.reduce((widest, row) => Math.max(widest, row.width), 0) + 1,
			[rows],
		);

		const first = Math.max(0, Math.floor(window.top / ROW_HEIGHT) - OVERSCAN);
		const last = Math.min(
			rows.length,
			Math.ceil((window.top + window.height) / ROW_HEIGHT) + OVERSCAN,
		);
		// Every row on screen shares one width, so the lanes stay in column while it changes.
		let shownLanes = 1;
		for (let index = first; index < last; index++) {
			const row = rows[index];
			if (row) shownLanes = Math.max(shownLanes, row.width + 1);
		}

		if (error) {
			return (
				<p data-testid="graph-error" className="p-8 tr-text-ui text-feedback-error">
					{error}
				</p>
			);
		}
		if (!history) return <p className="p-8 tr-text-ui text-text-muted">Reading history…</p>;
		if (rows.length === 0) {
			return (
				<p data-testid="graph-empty" className="p-8 tr-text-ui text-text-muted">
					No commits on any branch yet.
				</p>
			);
		}

		return (
			<div ref={host}>
				<div
					data-testid="graph-panel"
					data-rows={rows.length}
					data-lanes={shownLanes}
					data-more={hasMore || undefined}
					className="relative"
					style={{ height: rows.length * ROW_HEIGHT }}
				>
					<div className="absolute inset-x-0" style={{ top: first * ROW_HEIGHT }}>
						{rows.slice(first, last).map((row) => {
							const here = marks.get(row.commit.sha) ?? [];
							return (
								<button
									key={row.commit.sha}
									type="button"
									data-testid="graph-commit"
									data-sha={row.commit.shortSha}
									onClick={() =>
										ctx.setDiffScope(workspaceId, { kind: "commit", sha: row.commit.sha })
									}
									className="flex h-40 w-full items-stretch gap-8 pr-8 text-left hover:bg-control-bg-hovered"
								>
									<Lanes row={row} drawn={drawnLanes} shown={shownLanes} marked={here.length > 0} />
									<span className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden">
										<span className="truncate tr-text-ui text-text-default">
											{row.commit.subject}
										</span>
										<span className="flex min-w-0 items-center gap-4 tr-text-metadata text-text-subtle">
											<span className="shrink-0">{row.commit.shortSha}</span>
											<span className="min-w-0 shrink truncate">{row.commit.author}</span>
											{row.commit.refs.map((ref) => (
												<span
													key={ref}
													data-testid="graph-ref"
													className="min-w-0 max-w-[12rem] truncate rounded-[var(--radius-sm)] bg-primary-subtle px-4 text-primary"
												>
													{ref}
												</span>
											))}
											{here.map((name) => (
												<span
													key={name}
													data-testid="graph-worktree"
													className="min-w-0 max-w-[10rem] truncate text-text-muted"
												>
													⌂ {name}
												</span>
											))}
										</span>
									</span>
								</button>
							);
						})}
					</div>
				</div>
			</div>
		);
	};
}
