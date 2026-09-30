import {expect, test} from 'bun:test';
import {chatPickerPlacement} from './chatPickerGeometry.ts';

test('picker aligns to the actual opener with the original gap on either side', () => {
  const bounds = {x: 100, y: 50, width: 400, height: 500};
  expect(chatPickerPlacement({x: 132, y: 70, width: 80, height: 32}, bounds, 160, 140))
    .toEqual({left: 32, top: 58, width: 160, maxHeight: 438});
  expect(chatPickerPlacement({x: 132, y: 490, width: 80, height: 32}, bounds, 160, 140))
    .toEqual({left: 32, top: 294, width: 160, maxHeight: 430});
});

test('picker stays inside a narrow overlay and constrains to the larger side', () => {
  const bounds = {x: 100, y: 50, width: 200, height: 200};
  expect(chatPickerPlacement({x: 280, y: 170, width: 16, height: 32}, bounds, 320, 360))
    .toEqual({left: 4, top: 4, width: 192, maxHeight: 110});
  expect(chatPickerPlacement({x: 90, y: 55, width: 16, height: 32}, bounds, 160, 360))
    .toEqual({left: 4, top: 43, width: 160, maxHeight: 153});
});

test('content growth can flip a menu without locking its height to the previous constraint', () => {
  const trigger = {x: 140, y: 190, width: 80, height: 32};
  const bounds = {x: 100, y: 50, width: 400, height: 300};
  expect(chatPickerPlacement(trigger, bounds, 320, 64))
    .toEqual({left: 40, top: 178, width: 320, maxHeight: 118});
  expect(chatPickerPlacement(trigger, bounds, 320, 344))
    .toEqual({left: 40, top: 4, width: 320, maxHeight: 130});
  expect(chatPickerPlacement(trigger, {...bounds, height: 600}, 320, 344))
    .toEqual({left: 40, top: 178, width: 320, maxHeight: 418});
});
