import type {PiEvent} from '../../../packages/contracts/src';
import type {ChatMessage} from './HostClient';

export type CompactionState = {status: 'running' | 'cancelled' | 'failed' | 'done'; detail?: string; tokensBefore?: number; tokensAfter?: number; resuming?: boolean; summary?: string};
let sequence = 0;

export function compactionState(message: ChatMessage): CompactionState | undefined {
  if (message.compaction) return message.compaction;
  if (message.role === 'compactionSummary' && typeof message.summary === 'string') return {status: 'done', summary: message.summary, tokensBefore: message.tokensBefore};
  return undefined;
}

export function foldCompactionEvent(messages: ChatMessage[], event: PiEvent): ChatMessage[] {
  if (event.type === 'agent_start') {
    if (!messages.some(message => message.compaction?.resuming)) return messages;
    return messages.map(message => message.compaction?.resuming ? {...message, compaction: {...message.compaction, resuming: false}} : message);
  }
  if (event.type === 'compaction_start') return [...messages, {role: 'compactionNotice', compactionId: ++sequence, compaction: {status: 'running'}}];
  if (event.type !== 'compaction_end') return messages;
  const outcome: CompactionState = event.aborted ? {status: 'cancelled'} : event.errorMessage ? {status: 'failed', detail: event.errorMessage}
    : {status: 'done', tokensBefore: event.result?.tokensBefore, tokensAfter: event.result?.estimatedTokensAfter, resuming: event.willRetry};
  const index = messages.reduce((found, message, i) => message.compaction?.status === 'running' ? i : found, -1);
  const settled: ChatMessage = {role: 'compactionNotice', compactionId: index < 0 ? ++sequence : messages[index].compactionId, compaction: outcome};
  return index < 0 ? [...messages, settled] : messages.map((message, i) => i === index ? settled : message);
}

export function compactionIds(messages: ChatMessage[]): Set<number> {
  return new Set(messages.flatMap(message => message.compactionId === undefined ? [] : [message.compactionId]));
}

export function appendCompactionFailure(messages: ChatMessage[], observed: Set<number>, detail: string): ChatMessage[] {
  if ([...compactionIds(messages)].some(id => !observed.has(id))) return messages;
  return [...messages, {role: 'compactionNotice', compactionId: ++sequence, compaction: {status: 'failed', detail}}];
}

export function formatCompactionTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}
