import { RiAddLine as Plus } from "@remixicon/react";
import { Fragment } from "react";
import { ContextMenuItem } from "../../components/ui/context-menu";
import type { LayoutAuxiliaryRegion } from "./types";

export interface PlacementGroup {
	groupId: string;
	/** Where the group is, not what is open in it: a title in a 60px box says nothing but its first word. */
	label: string;
	/** What it holds, for the tooltip — the answer to "which one is that?" without spending the box on it. */
	holds?: string;
	/** The group this tab is already in: shown as where it stands, never as somewhere to go. */
	current: boolean;
}

export interface PlacementSlot {
	index: number;
	label: string;
	available: boolean;
	unavailable: string | null;
}

export interface PlacementRegion {
	region: LayoutAuxiliaryRegion;
	/** A region this kind of tab cannot live in is drawn, not offered. */
	allowed: boolean;
	groups: PlacementGroup[];
	/** One more than the groups: the gaps before each one, and the end. */
	slots: PlacementSlot[];
}

const CELL_CLASS =
	"min-w-0 justify-center overflow-hidden rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-4 py-2 text-center tr-text-label-pill text-text-muted focus:text-text-default data-[disabled]:border-border-muted data-[disabled]:bg-transparent";

const SLOT_CLASS =
	"justify-center rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-0 py-0 text-text-muted focus:bg-primary-subtle focus:text-text-default data-[disabled]:border-border-muted data-[disabled]:border-dashed data-[disabled]:bg-transparent data-[disabled]:text-control-disabled-text [&_svg]:size-12";

function Slot({
	region,
	slot,
	horizontal,
	onSelect,
}: {
	region: LayoutAuxiliaryRegion;
	slot: PlacementSlot;
	horizontal: boolean;
	onSelect: () => void;
}) {
	return (
		<ContextMenuItem
			data-testid="placement-slot"
			data-region={region}
			data-index={slot.index}
			aria-label={slot.label}
			title={slot.unavailable ?? slot.label}
			disabled={!slot.available}
			onSelect={onSelect}
			className={`${SLOT_CLASS} shrink-0 ${horizontal ? "w-14 self-stretch" : "h-14"}`}
		>
			<Plus aria-hidden="true" />
		</ContextMenuItem>
	);
}

function Cell({
	group,
	area,
	onSelect,
}: {
	group: PlacementGroup;
	area: LayoutAuxiliaryRegion | "center";
	onSelect: () => void;
}) {
	return (
		<ContextMenuItem
			data-testid="placement-group"
			data-area={area}
			data-current={group.current || undefined}
			aria-label={
				group.current ? `${group.label} — this group` : `Move to ${area} group: ${group.label}`
			}
			title={
				group.current
					? "This tab is already here"
					: `Move to ${group.label}${group.holds ? ` — ${group.holds}` : ""}`
			}
			disabled={group.current}
			onSelect={onSelect}
			className={`${CELL_CLASS} ${group.current ? "border-primary-muted bg-primary-subtle" : ""}`}
		>
			<span className="line-clamp-2 min-w-0 flex-1 break-all">{group.label}</span>
		</ContextMenuItem>
	);
}

function Outline({ label, wide }: { label: string; wide?: boolean }) {
	return (
		<div
			className={`min-w-0 overflow-hidden rounded-[var(--radius-sm)] border border-border-muted border-dashed px-4 py-2 text-center tr-text-label-pill text-control-disabled-text ${wide ? "flex-1" : ""}`}
		>
			<span className="line-clamp-2 block break-all">{label}</span>
		</div>
	);
}

/**
 * Where a tab can go, as the shape of the workbench rather than a list of sentences naming its edges.
 * Every cell is still a menu item, so the keyboard and a screen reader read it as the list it replaced.
 * See SPEC.md.
 */
export function GroupPlacementPicker({
	regions,
	center,
	centerAllowed,
	onMove,
	onCreate,
}: {
	regions: PlacementRegion[];
	center: PlacementGroup[];
	centerAllowed: boolean;
	onMove: (area: LayoutAuxiliaryRegion | "center", groupId: string) => void;
	onCreate: (region: LayoutAuxiliaryRegion, index: number) => void;
}) {
	const groupAt = (entry: PlacementRegion, index: number) => {
		const group = entry.groups[index];
		if (!group) return null;
		return (
			<Cell
				group={group}
				area={entry.region}
				onSelect={() => onMove(entry.region, group.groupId)}
			/>
		);
	};
	const side = (region: LayoutAuxiliaryRegion) => regions.find((entry) => entry.region === region);
	const left = side("left");
	const right = side("right");
	const bottom = side("bottom");

	const column = (entry: PlacementRegion | undefined) =>
		entry ? (
			<div className="flex w-80 shrink-0 flex-col gap-2">
				{entry.allowed
					? null
					: entry.groups.map((group) => <Outline key={group.groupId} label={group.label} />)}
				{entry.allowed
					? entry.slots.map((slot, index) => (
							<Fragment key={slot.index}>
								<Slot
									region={entry.region}
									slot={slot}
									horizontal={false}
									onSelect={() => onCreate(entry.region, slot.index)}
								/>
								{groupAt(entry, index)}
							</Fragment>
						))
					: null}
			</div>
		) : (
			<div className="w-80 shrink-0" />
		);

	return (
		<div className="flex w-[320px] flex-col gap-4 px-8 py-4">
			<span className="tr-text-eyebrow text-text-muted">Move pane</span>
			<div className="flex gap-4">
				{column(left)}
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<div className="flex flex-1 flex-col gap-2 rounded-[var(--radius-sm)] border border-border-muted border-dashed p-4">
						{center.length === 0 || !centerAllowed ? (
							center.length === 0 ? (
								<span className="m-auto tr-text-label-pill text-text-muted">Editor</span>
							) : (
								center.map((group) => <Outline key={group.groupId} label={group.label} wide />)
							)
						) : (
							center.map((group) => (
								<Cell
									key={group.groupId}
									group={group}
									area="center"
									onSelect={() => onMove("center", group.groupId)}
								/>
							))
						)}
					</div>
					{bottom ? (
						<div className="flex min-w-0 gap-2">
							{bottom.allowed
								? null
								: bottom.groups.map((group) => (
										<Outline key={group.groupId} label={group.label} wide />
									))}
							{bottom.allowed
								? bottom.slots.map((slot, index) => (
										<Fragment key={slot.index}>
											<Slot
												region="bottom"
												slot={slot}
												horizontal
												onSelect={() => onCreate("bottom", slot.index)}
											/>
											{groupAt(bottom, index)}
										</Fragment>
									))
								: null}
						</div>
					) : null}
				</div>
				{column(right)}
			</div>
		</div>
	);
}
