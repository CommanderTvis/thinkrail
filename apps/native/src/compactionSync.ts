import type {ChatMessage} from './HostClient';
import {compactionState} from './compactionModel';

export type TranscriptContext = {sessionId: string; workspaceId: string; generation: number; revision: number; connected: boolean; streaming: boolean};

export function transcriptSyncDecision(before: TranscriptContext, current: TranscriptContext, hostStreaming: boolean): 'stale' | 'wait' | 'retry' | 'apply' {
  if (!current.connected || before.generation !== current.generation || before.sessionId !== current.sessionId || before.workspaceId !== current.workspaceId) return 'stale';
  if (current.streaming || hostStreaming) return 'wait';
  return before.revision === current.revision ? 'apply' : 'retry';
}

export function needsCompactionSync(messages: ChatMessage[]): boolean {
  return messages.some(message => message.compaction?.status === 'done' && message.compaction.summary === undefined);
}

export function reconcileCompactionMessages(live: ChatMessage[], canonical: ChatMessage[]): ChatMessage[] {
  const completed = [...live].reverse().find(message => message.compaction?.status === 'done')?.compaction;
  if (!completed || completed.tokensAfter === undefined) return canonical;
  const index = canonical.reduce((found, message, i) => message.role === 'compactionSummary' ? i : found, -1);
  const summary = index < 0 ? undefined : compactionState(canonical[index]);
  if (!summary || summary.tokensBefore !== completed.tokensBefore) return canonical;
  return canonical.map((message, i) => i === index ? {...message, compaction: {...summary, tokensAfter: completed.tokensAfter}} : message);
}
