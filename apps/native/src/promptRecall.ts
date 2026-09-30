import type {ChatMessage} from './HostClient';

export type PromptRecallCursor = {context: string; index: number};

export function promptRecallIndex(cursor: PromptRecallCursor | null, context: string, draft: string, prompts: readonly string[]) {
  return cursor?.context === context && prompts[cursor.index] === draft ? cursor.index : null;
}

export function recentChatPrompts(messages: readonly ChatMessage[]) {
  const texts = messages.filter(message => message.role === 'user').map(message => {
    if (typeof message.content === 'string') return message.content;
    if (!Array.isArray(message.content)) return '';
    return message.content.flatMap(block => {
      if (typeof block !== 'object' || block === null) return [];
      const value = block as {type?: string; text?: string};
      return value.type === 'text' && typeof value.text === 'string' ? [value.text] : [];
    }).join('\n');
  }).filter(Boolean);
  return [...new Set(texts.reverse())];
}

export function promptRecallStep(key: string, draft: string, index: number | null, prompts: readonly string[]) {
  if (key === 'ArrowUp' && (draft === '' || index !== null) && prompts.length) {
    const next = index === null ? 0 : Math.min(index + 1, prompts.length - 1);
    return {index: next, text: prompts[next] ?? ''};
  }
  if (key === 'ArrowDown' && index !== null) {
    const next = index === 0 ? null : index - 1;
    return {index: next, text: next === null ? '' : prompts[next] ?? ''};
  }
  return null;
}
