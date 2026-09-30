import type {ChatMessage} from './HostClient';
import type {ChatRow} from './chatRows';
import {parseToolResultContent, type ToolImage} from './toolResultContent';
import {matchesSkillInvocationCommand, parseSkillInvocation} from './skillInvocation';

export type ChatAttachment = {key: string; label: string; image: ToolImage};

export function chatMessageAttachments(content: unknown): ChatAttachment[] {
  if (!Array.isArray(content)) return [];
  const seen = new Map<string, number>();
  return parseToolResultContent({content}).images.map(image => {
    const tail = image.data.slice(-24);
    const occurrence = seen.get(tail) ?? 0;
    seen.set(tail, occurrence + 1);
    return {key: `${tail}-${occurrence}`, label: image.mimeType, image};
  });
}

export function chatMessageText(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return message.summary ?? '';
  return message.content.flatMap(block => {
    if (typeof block !== 'object' || block === null) return [];
    const value = block as {type?: string; text?: string};
    return value.type === 'text' && typeof value.text === 'string' ? [value.text] : [];
  }).join('');
}

export function reconcileUserMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const prior = messages.at(-1);
  if (prior?.role === 'user') {
    if (JSON.stringify(prior.content) === JSON.stringify(message.content)) return messages;
    const skill = parseSkillInvocation(chatMessageText(message));
    if (skill && matchesSkillInvocationCommand(chatMessageText(prior), skill)) return [...messages.slice(0, -1), message];
  }
  return [...messages, message];
}

export function messageActions(rows: readonly ChatRow[], streaming: boolean): {
  responded: ReadonlyMap<string, boolean>; finalAnswers: ReadonlySet<string>;
} {
  const responded = new Map<string, boolean>();
  const finalAnswers = new Set<string>();
  let sawResponse = false;
  let sawLaterUser = false;
  let roundHasLaterContent = false;
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (row.message.role === 'user') {
      responded.set(row.id, sawResponse || (!sawLaterUser && streaming));
      sawLaterUser = true;
      roundHasLaterContent = false;
    } else if (row.message.role === 'assistant' && (row.activity || chatMessageText(row.message).trim())) {
      sawResponse = true;
      if (!row.activity && !roundHasLaterContent) finalAnswers.add(row.id);
      roundHasLaterContent = true;
    }
  }
  return {responded, finalAnswers};
}
