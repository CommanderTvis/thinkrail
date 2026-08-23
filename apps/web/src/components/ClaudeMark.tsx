// Twelve spokes on a 9px radius, so the mark is radially symmetric and sits inside the same ~2px inset
// lucide icons use — at full-bleed it read as bigger than its neighbours and off-centre beside them.
const SPOKES =
	"M12.00 9.60L12.00 3.00M13.20 9.92L16.50 4.21M14.08 10.80L19.79 7.50M14.40 12.00L21.00 12.00M14.08 13.20L19.79 16.50M13.20 14.08L16.50 19.79M12.00 14.40L12.00 21.00M10.80 14.08L7.50 19.79M9.92 13.20L4.21 16.50M9.60 12.00L3.00 12.00M9.92 10.80L4.21 7.50M10.80 9.92L7.50 4.21";

export function ClaudeMark({ className }: { className?: string | undefined }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2.4}
			strokeLinecap="round"
			aria-hidden="true"
			focusable="false"
			className={className}
		>
			<path d={SPOKES} />
		</svg>
	);
}
