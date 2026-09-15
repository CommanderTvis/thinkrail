const MIN_SPLIT_COLUMNS = 40;
const SIDE_CHROME_PX = 70;
const MONOSPACE_ADVANCE = 0.6;

export function narrowForSplit(paneWidth: number, fontSize: number): boolean {
	if (paneWidth <= 0) return false;
	const columns = (paneWidth / 2 - SIDE_CHROME_PX) / (fontSize * MONOSPACE_ADVANCE);
	return columns < MIN_SPLIT_COLUMNS;
}
