import {expect, test} from 'bun:test';
import {themeMenuFocus, themeMenuPlacement} from './themeMenuModel.ts';

const dialog = {x: 100, y: 100, width: 832, height: 480};
const trigger = {x: 400, y: 200, width: 240, height: 32};

test('theme menu aligns to its trigger in dialog coordinates without changing the trigger width', () => {
  expect(themeMenuPlacement(trigger, dialog, 66)).toEqual({left: 300, top: 136, width: 240, maxHeight: 66});
});

test('a bottom trigger opens above rather than clipping the menu', () => {
  expect(themeMenuPlacement({...trigger, y: 550}, dialog, 66)).toEqual({left: 300, top: 380, width: 240, maxHeight: 66});
});

test('a narrow dialog constrains an oversized trigger and scrolls a tall menu within available space', () => {
  const frame = {x: 0, y: 0, width: 180, height: 200};
  const rect = themeMenuPlacement({x: 170, y: 90, width: 300, height: 32}, frame, 500);
  expect(rect).toEqual({left: 4, top: 4, width: 172, maxHeight: 82});
});

test('partially clipped triggers keep menu bounds inside the dialog', () => {
  for (const y of [0, 80, 580, 700]) {
    const rect = themeMenuPlacement({...trigger, x: 0, y}, dialog, 66);
    expect(rect.left).toBeGreaterThanOrEqual(4);
    expect(rect.top).toBeGreaterThanOrEqual(4);
    expect(rect.top + rect.maxHeight).toBeLessThanOrEqual(dialog.height - 4);
    expect(rect.left + rect.width).toBeLessThanOrEqual(dialog.width - 4);
  }
});

test('keyboard navigation wraps and supports direct first/last movement', () => {
  expect(themeMenuFocus('ArrowDown', 1, 2)).toBe(0);
  expect(themeMenuFocus('ArrowUp', 0, 2)).toBe(1);
  expect(themeMenuFocus('Home', 1, 2)).toBe(0);
  expect(themeMenuFocus('End', 0, 2)).toBe(1);
  expect(themeMenuFocus('Escape', 1, 2)).toBeNull();
});
