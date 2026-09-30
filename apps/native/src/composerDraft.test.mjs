import {expect, test} from 'bun:test';
import {composerDraftFromTransition, emptyComposerDraft, replaceComposerDraftText} from './composerDraft';
import {applyTemplateSlotEdit, beginTemplateSlotSession, finalizeTemplateSlotSession, parseTemplateSlots, stepTemplateSlotSession} from './templateSlots';

test('a retained draft resumes edited repeated slots after the chat pane is recreated', () => {
  const begun = beginTemplateSlotSession(parseTemplateSlots('Review $1 and $1 in ${2:-src/}', '[file] [scope]'));
  const initial = composerDraftFromTransition(begun);
  const slot = initial.slots.slots[0];
  const editedText = initial.text.slice(0, slot.start) + 'core.ts' + initial.text.slice(slot.end);
  const retained = {text: editedText, slots: applyTemplateSlotEdit(initial.text, editedText, slot.start + 7, initial.slots)};
  const reopened = structuredClone(retained);
  expect(reopened.slots.slots[0].edited).toBe(true);
  const advanced = composerDraftFromTransition(stepTemplateSlotSession(reopened.text, reopened.slots, 1));
  expect(advanced.text).toBe('Review core.ts and core.ts in src/');
  expect(advanced.slots.activeIndex).toBe(1);
  expect(finalizeTemplateSlotSession(advanced.text, advanced.slots)).toBe('Review core.ts and core.ts in src/');
  expect(initial.text).toBe(begun.value);
  expect(initial.slots.slots[0].edited).not.toBe(true);
});

test('submission and rejected-text restoration discard obsolete slot offsets', () => {
  const drafted = composerDraftFromTransition(beginTemplateSlotSession(parseTemplateSlots('Review $1')));
  const cleared = replaceComposerDraftText(drafted, '');
  expect(cleared).toEqual(emptyComposerDraft);
  const newer = replaceComposerDraftText(cleared, 'New work');
  const restored = replaceComposerDraftText(newer, text => `${text}\n\nReview core.ts`);
  expect(restored).toEqual({text: 'New work\n\nReview core.ts', slots: null});
  expect(drafted.slots).not.toBeNull();
});
