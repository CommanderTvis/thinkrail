type PickerKey = {key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean};

export function pickerNavigation(event: PickerKey, current: number, count: number, groups?: readonly number[]) {
  if (!count) return null;
  const down = event.key === 'ArrowDown' || (event.ctrlKey && ['n', 'j'].includes(event.key));
  const up = event.key === 'ArrowUp' || (event.ctrlKey && ['p', 'k'].includes(event.key));
  if (event.key === 'Home' || (up && event.metaKey)) return 0;
  if (event.key === 'End' || (down && event.metaKey)) return count - 1;
  if (event.altKey && (down || up) && groups) {
    const step = down ? 1 : -1;
    for (let index = current + step; index >= 0 && index < count; index += step) {
      if (groups[index] !== groups[current]) return groups.indexOf(groups[index]);
    }
  }
  if (down) return Math.min(count - 1, Math.max(0, current + 1));
  if (up) return Math.max(0, Math.min(count - 1, current - 1));
  return null;
}

export function pickerScrollOffset(top: number, height: number, offset: number, viewport: number) {
  if (viewport <= 0) return null;
  if (top < offset) return Math.max(0, top - 4);
  if (top + height > offset + viewport) return Math.max(0, top + height - viewport + 4);
  return null;
}

export const pickerNavigationKeys = [
  ...['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].map(key => ({key})),
  ...['ArrowDown', 'ArrowUp'].map(key => ({key, metaKey: true})),
  ...['n', 'j', 'p', 'k'].map(key => ({key, ctrlKey: true})),
];
