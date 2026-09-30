import {expect, test} from 'bun:test';
import {composerInputHeight} from './composerGeometry.ts';

test('short drafts grow and shrink from their measured content height', () => {
  expect(composerInputHeight(18, 600, 'compact')).toBe(36);
  expect(composerInputHeight(56, 600, 'compact')).toBe(56);
  expect(composerInputHeight(36, 600, 'compact')).toBe(36);
});

test('compact and roomy cap at six and ten visual lines including padding', () => {
  expect(composerInputHeight(800, 600, 'compact')).toBe(136);
  expect(composerInputHeight(800, 600, 'roomy')).toBe(216);
});

test('half-chat uses the mounted pane size and reserves space for the footer', () => {
  expect(composerInputHeight(800, 600, 'half-chat')).toBe(252);
  expect(composerInputHeight(800, 400, 'half-chat')).toBe(152);
  expect(composerInputHeight(76, 600, 'half-chat')).toBe(76);
  expect(composerInputHeight(800, 0, 'half-chat')).toBe(36);
});
