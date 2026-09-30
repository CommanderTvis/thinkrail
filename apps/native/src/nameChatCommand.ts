import {normalizeSessionTitle, SESSION_TITLE_MAX_LENGTH} from '../../../packages/contracts/src';
import type {SlashCommandItem} from './slashCompletion';

export const nameChatCommand: SlashCommandItem = {
  name: 'name', description: 'Rename this chat · requires a title', source: 'builtin',
  sourceInfo: {path: '<builtin:name>', source: 'pi', scope: 'temporary', origin: 'top-level'},
};

export function nameChatCommandTitle(text: string): string | null {
  if (text === '/name') return '';
  return text.startsWith('/name ') ? text.slice(6) : null;
}

export function prepareChatRename(titleInput: string, hasImages: boolean): {title: string} | {reason: string} {
  if (hasImages) return {reason: 'Remove images to use /name'};
  const title = normalizeSessionTitle(titleInput);
  if (title) return {title};
  return {reason: titleInput.trim() ? `Keep chat names to ${SESSION_TITLE_MAX_LENGTH} characters or fewer.` : 'Enter a chat name.'};
}
