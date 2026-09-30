import {expect, test} from 'bun:test';
import {pickerNavigation, pickerScrollOffset} from './chatPickerNavigation.ts';

test('command-list navigation clamps endpoints and handles empty results', () => {
  expect(pickerNavigation({key: 'ArrowDown'}, 1, 3)).toBe(2);
  expect(pickerNavigation({key: 'ArrowDown'}, 2, 3)).toBe(2);
  expect(pickerNavigation({key: 'ArrowUp'}, 0, 3)).toBe(0);
  expect(pickerNavigation({key: 'Home'}, 2, 3)).toBe(0);
  expect(pickerNavigation({key: 'End'}, 0, 3)).toBe(2);
  expect(pickerNavigation({key: 'ArrowDown'}, -1, 0)).toBeNull();
  expect(pickerNavigation({key: 'Enter'}, 0, 3)).toBeNull();
});

test('model command-list modifier bindings match cmdk', () => {
  expect(pickerNavigation({key: 'ArrowDown', metaKey: true}, 0, 4)).toBe(3);
  expect(pickerNavigation({key: 'ArrowUp', metaKey: true}, 3, 4)).toBe(0);
  for (const key of ['n', 'j']) expect(pickerNavigation({key, ctrlKey: true}, 1, 4)).toBe(2);
  for (const key of ['p', 'k']) expect(pickerNavigation({key, ctrlKey: true}, 1, 4)).toBe(0);
  expect(pickerNavigation({key: 'n'}, 1, 4)).toBeNull();
});

test('Alt navigation selects the adjacent visible provider group, with cmdk boundary fallback', () => {
  const groups = [-1, 0, 0, 0, 1, 1, 2];
  expect(pickerNavigation({key: 'ArrowDown', altKey: true}, 0, groups.length, groups)).toBe(1);
  expect(pickerNavigation({key: 'ArrowDown', altKey: true}, 2, groups.length, groups)).toBe(4);
  expect(pickerNavigation({key: 'ArrowUp', altKey: true}, 5, groups.length, groups)).toBe(1);
  expect(pickerNavigation({key: 'ArrowUp', altKey: true}, 1, groups.length, groups)).toBe(0);
  expect(pickerNavigation({key: 'ArrowDown', altKey: true}, 4, 6, groups.slice(0, 6))).toBe(5);
  expect(pickerNavigation({key: 'ArrowDown', altKey: true}, 6, groups.length, groups)).toBe(6);
  expect(pickerNavigation({key: 'ArrowUp', altKey: true}, 0, groups.length, groups)).toBe(0);
  expect(pickerNavigation({key: 'ArrowDown', altKey: true, metaKey: true}, 1, groups.length, groups)).toBe(6);
  expect(pickerNavigation({key: 'p', altKey: true, ctrlKey: true}, 6, groups.length, groups)).toBe(4);
  expect(pickerNavigation({key: 'ArrowDown', altKey: true}, 0, 3, [0, 0, 0])).toBe(1);
});

test('active rows scroll only when outside the viewport, preserving the edge inset', () => {
  expect(pickerScrollOffset(120, 44, 100, 100)).toBeNull();
  expect(pickerScrollOffset(80, 44, 100, 100)).toBe(76);
  expect(pickerScrollOffset(180, 44, 100, 100)).toBe(128);
  expect(pickerScrollOffset(0, 28, 50, 100)).toBe(0);
  expect(pickerScrollOffset(180, 44, 100, 0)).toBeNull();
});
