import type {TemplateSlotSessionState, TemplateSlotSessionTransition} from './templateSlots';

export type ComposerDraft = {text: string; slots: TemplateSlotSessionState | null};
export const emptyComposerDraft: ComposerDraft = {text: '', slots: null};

export function replaceComposerDraftText(draft: ComposerDraft, change: string | ((text: string) => string)): ComposerDraft {
  return {text: typeof change === 'function' ? change(draft.text) : change, slots: null};
}

export function composerDraftFromTransition(transition: TemplateSlotSessionTransition): ComposerDraft {
  return {text: transition.value, slots: transition.session};
}
