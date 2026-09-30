export type SubmitBehavior = 'send' | 'steer' | 'followUp' | 'interrupt';
type ComposerKey = {key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean};

export function composerKeyBehavior(event: ComposerKey, streaming: boolean): SubmitBehavior | null {
  if (event.key !== 'Enter') return null;
  const modified = event.metaKey || event.ctrlKey;
  if (event.shiftKey && !modified) return null;
  if (!streaming) return 'send';
  return modified ? event.shiftKey ? 'interrupt' : 'followUp' : 'steer';
}

const modifiers = [false, true];
export const composerSendKeys = modifiers.flatMap(metaKey => modifiers.flatMap(ctrlKey =>
  modifiers.flatMap(shiftKey => modifiers.map(altKey => ({key: 'Enter', metaKey, ctrlKey, shiftKey, altKey}))),
)).filter(event => composerKeyBehavior(event, false) !== null);

export const streamingSendModes = [
  {behavior: 'steer', name: 'Steer', meaning: "delivers at the agent's next step", keys: 'Enter'},
  {behavior: 'followUp', name: 'Queue', meaning: 'runs after the agent finishes', keys: 'Cmd/Ctrl+Enter'},
  {behavior: 'interrupt', name: 'Interrupt', meaning: 'stops the current response and sends now', keys: 'Cmd/Ctrl+Shift+Enter'},
] satisfies {behavior: SubmitBehavior; name: string; meaning: string; keys: string}[];
