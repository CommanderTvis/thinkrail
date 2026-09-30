import {type SetStateAction, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {composerDraftFromTransition, replaceComposerDraftText, type ComposerDraft} from './composerDraft';
import type {TextInput} from 'react-native';
import {hostClient, type TemplateInfo} from './HostClient';
import type {SlashCommandInfo, TemplateReadLocation} from '../../../packages/contracts/src';
import {stripFrontmatter} from './frontmatter';
import {matchSlashCommands, nativeEditCaret, selectedSlashCommandValue, shouldApplyTemplatePick, slashCommandCatalogOrEmpty, slashCommandQuery, slashCompletionKeyAction, templateToSlashCommand, type SlashCommandItem} from './slashCompletion';
import {applyTemplateSlotEdit, beginTemplateSlotSession, finalizeTemplateSlotSession, parseTemplateSlots, stepTemplateSlotSession} from './templateSlots';

export type PromptCommandSource = {
  context: string;
  location: TemplateReadLocation | null;
  loadCommands: (() => Promise<SlashCommandInfo[]>) | null;
  builtins: SlashCommandItem[];
};

export function useComposerTemplates(composerDraft: ComposerDraft, onChange: (draft: SetStateAction<ComposerDraft>) => void, source: PromptCommandSource) {
  const {text: draft, slots} = composerDraft;
  const setSlots = (next: ComposerDraft['slots']) => onChange(current => ({...current, slots: next}));
  const input = useRef<TextInput>(null);
  const selection = useRef({start: draft.length, end: draft.length});
  const {context, location, loadCommands, builtins} = source;
  const live = useRef({draft, context}).current;
  live.draft = draft; live.context = context;
  const request = useRef({generation: 0, pending: false}).current;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [commands, setCommands] = useState<SlashCommandInfo[]>([]);
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [focus, setFocus] = useState<{value: string; start: number; end: number} | undefined>(() => {
    const slot = slots?.slots[slots.activeIndex];
    return slot ? {value: draft, start: slot.start, end: slot.end} : undefined;
  });
  const slashActive = slashCommandQuery(draft) !== null;
  const reserved = new Set(builtins.map(command => command.name));
  const catalog = [...builtins, ...commands.filter(command => command.source !== 'prompt' && !reserved.has(command.name)), ...(templates ?? []).filter(template => !reserved.has(template.name)).map(templateToSlashCommand)];
  const matches = matchSlashCommands(draft, catalog);
  const open = slashActive && !dismissed && matches.length > 0;
  const index = Math.min(activeIndex, Math.max(0, matches.length - 1));
  const reset = JSON.stringify([slashCommandQuery(draft), catalog.map(command => command.name)]);
  const [lastReset, setLastReset] = useState(reset);
  if (lastReset !== reset) {setLastReset(reset); setActiveIndex(0); setDismissed(false);}

  useEffect(() => {
    request.generation++; request.pending = false; setPending(false); setError(''); setTemplates(null);
    return () => {request.generation++; request.pending = false;};
  }, [context, request]);
  const locationKey = JSON.stringify(location);
  useEffect(() => {
    let current = true; setCommands([]);
    if (loadCommands) slashCommandCatalogOrEmpty(loadCommands).then(next => {if (current) setCommands(next);});
    return () => {current = false;};
  }, [context, loadCommands]);
  useEffect(() => {
    setTemplates(null);
    const at: TemplateReadLocation | null = JSON.parse(locationKey);
    if (!slashActive || !at) return;
    let current = true;
    hostClient.listTemplates(at).then(result => {if (current) setTemplates(result.templates);}).catch(() => {});
    return () => {current = false;};
  }, [slashActive, locationKey]);
  useLayoutEffect(() => {
    if (!focus || draft !== focus.value) return;
    selection.current = {start: focus.start, end: focus.end};
    input.current?.focus(); input.current?.setSelection(focus.start, focus.end); setFocus(undefined);
  }, [focus, draft]);

  const pick = async (command: SlashCommandItem) => {
    setDismissed(true); setError(''); input.current?.focus();
    if (command.source !== 'prompt') {
      const value = selectedSlashCommandValue(command); onChange(current => replaceComposerDraftText(current, value)); setFocus({value, start: value.length, end: value.length}); return;
    }
    const template = templates?.find(item => item.name === command.name);
    if (!template) return;
    const ticket = ++request.generation;
    const draftAtPick = live.draft, contextAtPick = live.context;
    request.pending = true; setPending(true);
    try {
      if (!location) return;
      const loaded = await hostClient.getTemplate(template, location);
      if (!shouldApplyTemplatePick({generation: ticket, latestGeneration: request.generation, draftAtPick, currentDraft: live.draft, contextAtPick, currentContext: live.context})) return;
      const transition = beginTemplateSlotSession(parseTemplateSlots(stripFrontmatter(loaded.content), loaded.argumentHint));
      onChange(composerDraftFromTransition(transition)); setFocus({value: transition.value, ...transition.selection});
    } catch (reason) {if (ticket === request.generation) setError(String(reason));}
    finally {if (ticket === request.generation) {request.pending = false; setPending(false);}}
  };
  const change = (next: string) => {
    const nextSlots = slots ? applyTemplateSlotEdit(live.draft, next, nativeEditCaret(live.draft, next, selection.current), slots) : null;
    live.draft = next; setError(''); onChange({text: next, slots: nextSlots});
  };
  const replaceText = (value: string) => {
    request.generation++; request.pending = false; setPending(false);
    live.draft = value;
    onChange(current => replaceComposerDraftText(current, value));
    setFocus({value, start: value.length, end: value.length});
  };
  const step = (direction: 1 | -1) => {
    if (!slots) return;
    const transition = stepTemplateSlotSession(live.draft, slots, direction);
    onChange(composerDraftFromTransition(transition)); setFocus({value: transition.value, ...transition.selection});
  };
  const handleKey = (event: {key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean}) => {
    const action = slashCompletionKeyAction(event.key, open, index, matches.length);
    if (action.type === 'move') setActiveIndex(action.index);
    if (action.type === 'dismiss') setDismissed(true);
    if (action.type === 'select') pick(matches[action.index]);
    if (action.type !== 'none') return true;
    if (slots && !open && event.key === 'Tab') {step(event.shiftKey ? -1 : 1); return true;}
    if (slots && !open && event.key === 'Escape') {setSlots(null); return true;}
    return false;
  };
  return {input, selection, open, matches, index, pick, pending, error, setError, slots, change, replaceText, handleKey, step, templatesEmpty: templates?.length === 0,
    isPending: () => request.pending,
    finalize: () => finalizeTemplateSlotSession(live.draft, slots)};
}
