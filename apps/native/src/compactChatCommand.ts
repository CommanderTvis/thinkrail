import type {SessionQueueContent} from '../../../packages/contracts/src';
import type {SlashCommandItem} from './slashCompletion';

export const compactChatCommand: SlashCommandItem = {
  name: 'compact', description: 'Manually compact context · optional instructions', source: 'builtin',
  sourceInfo: {path: '<builtin:compact>', source: 'pi', scope: 'temporary', origin: 'top-level'},
};

export function compactInstructions(text: string): string | null {
  if (text === '/compact') return '';
  return text.startsWith('/compact ') ? text.slice(9).trim() : null;
}

export function compactSubmissionError(hasDraftImages: boolean, hasQueuedImages: boolean): string | null {
  if (hasDraftImages) return 'Remove images to use /compact';
  return hasQueuedImages ? 'Wait for queued image messages to send before using /compact' : null;
}

export function queuedText(content: SessionQueueContent): string {
  return [...content.steering, ...content.followUp].map(message => message.text).join('\n\n');
}
