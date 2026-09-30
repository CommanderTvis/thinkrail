type Rect = {x: number; y: number; width: number; height: number};
export type ThemeMenuPlacement = {left: number; top: number; width: number; maxHeight: number};

export function themeMenuPlacement(trigger: Rect, dialog: Rect, height: number): ThemeMenuPlacement {
  const width = Math.min(Math.max(192, trigger.width), Math.max(0, dialog.width - 8));
  const below = Math.max(4, Math.min(trigger.y - dialog.y + trigger.height + 4, dialog.height - 4));
  const above = Math.max(4, Math.min(trigger.y - dialog.y - 4, dialog.height - 4));
  const belowSpace = Math.max(0, dialog.height - 4 - below);
  const aboveSpace = Math.max(0, above - 4);
  const useBelow = height <= belowSpace || (height > aboveSpace && belowSpace >= aboveSpace);
  const maxHeight = Math.min(height, useBelow ? belowSpace : aboveSpace);
  return {
    left: Math.max(4, Math.min(trigger.x - dialog.x, dialog.width - width - 4)),
    top: useBelow ? below : above - maxHeight,
    width, maxHeight,
  };
}

export function themeMenuFocus(key: string, current: number, count: number): number | null {
  if (key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowUp') return (current + count - 1) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
