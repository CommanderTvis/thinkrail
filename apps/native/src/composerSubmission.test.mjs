import {expect, test} from 'bun:test';
import {composerKeyBehavior, composerSendKeys} from './composerSubmission.ts';

test('Enter sends idle drafts and steers running sessions', () => {
  expect(composerKeyBehavior({key: 'Enter'}, false)).toBe('send');
  expect(composerKeyBehavior({key: 'Enter'}, true)).toBe('steer');
  expect(composerKeyBehavior({key: 'a'}, true)).toBeNull();
});

test('command and control distinguish queued and interrupted delivery only while running', () => {
  for (const modifier of ['metaKey', 'ctrlKey']) {
    expect(composerKeyBehavior({key: 'Enter', [modifier]: true}, true)).toBe('followUp');
    expect(composerKeyBehavior({key: 'Enter', [modifier]: true, shiftKey: true}, true)).toBe('interrupt');
    expect(composerKeyBehavior({key: 'Enter', [modifier]: true, shiftKey: true}, false)).toBe('send');
  }
});

test('native handling suppresses only send keys and preserves Shift+Enter for newlines', () => {
  for (let flags = 0; flags < 16; flags++) {
    const event = {key: 'Enter', metaKey: !!(flags & 1), ctrlKey: !!(flags & 2), shiftKey: !!(flags & 4), altKey: !!(flags & 8)};
    expect(composerSendKeys.some(key => JSON.stringify(key) === JSON.stringify(event))).toBe(composerKeyBehavior(event, true) !== null);
  }
  expect(composerKeyBehavior({key: 'Enter', shiftKey: true}, true)).toBeNull();
});
