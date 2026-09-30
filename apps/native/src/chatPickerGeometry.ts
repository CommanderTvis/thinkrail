export type PickerRect = {x: number; y: number; width: number; height: number};

export function chatPickerPlacement(trigger: PickerRect, bounds: PickerRect, width: number, height: number) {
  const menuWidth = Math.min(width, Math.max(0, bounds.width - 8));
  const above = Math.max(4, Math.min(trigger.y - bounds.y - 6, bounds.height - 4));
  const below = Math.max(4, Math.min(trigger.y - bounds.y + trigger.height + 6, bounds.height - 4));
  const aboveSpace = Math.max(0, above - 4);
  const belowSpace = Math.max(0, bounds.height - 4 - below);
  const useBelow = height <= belowSpace || (height > aboveSpace && belowSpace >= aboveSpace);
  const maxHeight = useBelow ? belowSpace : aboveSpace;
  return {
    left: Math.max(4, Math.min(trigger.x - bounds.x, bounds.width - menuWidth - 4)),
    top: useBelow ? below : above - Math.min(height, maxHeight),
    width: menuWidth, maxHeight,
  };
}
