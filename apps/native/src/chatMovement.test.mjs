import {expect, test} from 'bun:test';
import {defaultMovement, followTarget, moveHandle, parseMovement} from './chatMovement.ts';

test('movement handles preserve original limits, five-point steps, and minimum gap', () => {
  expect(moveHandle(defaultMovement, 'settle', 100)).toEqual({settle: 90, trigger: 100});
  expect(moveHandle(defaultMovement, 'trigger', 20)).toEqual({settle: 75, trigger: 85});
  expect(moveHandle(defaultMovement, 'settle', 42)).toEqual({settle: 40, trigger: 100});
  expect(moveHandle(defaultMovement, 'settle', -10)).toEqual({settle: 25, trigger: 100});
  expect(moveHandle(defaultMovement, 'trigger', Infinity)).toBe(defaultMovement);
});

test('invalid saved movement falls back to the original defaults', () => {
  for (const value of [null, [], '75,100', {settle: NaN, trigger: 100}, {settle: 75, trigger: Infinity},
    {settle: 76, trigger: 100}, {settle: 90, trigger: 95}, {settle: 20, trigger: 100}]) {
    expect(parseMovement(value)).toEqual({settle: 75, trigger: 100});
  }
  expect(parseMovement({settle: 60, trigger: 80})).toEqual({settle: 60, trigger: 80});
});

const geometry = {height: 600, contentHeight: 2000, edgeBottom: 1000, offset: 400,
  streaming: true, following: true, order: 'oldest-first', movement: defaultMovement};

test('a growing answer moves only after crossing the trigger, then lands at settle', () => {
  expect(followTarget(geometry)).toBeNull();
  expect(followTarget({...geometry, edgeBottom: 1002})).toBe(552);
  expect(followTarget({...geometry, edgeBottom: 600, offset: 100, movement: {settle: 60, trigger: 80}})).toBe(240);
  expect(followTarget({...geometry, force: true})).toBe(550);
});

test('detached readers stay put while finished chats follow the selected latest edge', () => {
  expect(followTarget({...geometry, edgeBottom: 1800, following: false})).toBeNull();
  expect(followTarget({...geometry, height: 0})).toBeNull();
  expect(followTarget({...geometry, streaming: false})).toBe(1400);
  expect(followTarget({...geometry, streaming: false, order: 'newest-first'})).toBe(0);
  expect(followTarget({...geometry, edgeBottom: 2000, contentHeight: 1100})).toBe(500);
});
