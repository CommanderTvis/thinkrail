import {expect, test} from 'bun:test';
import {compactInstructions, compactSubmissionError, queuedText} from './compactChatCommand';
import {appendCompactionFailure, compactionIds, foldCompactionEvent} from './compactionModel';
import {reconcileCompactionMessages, transcriptSyncDecision} from './compactionSync';

test('/compact reserves exact spelling and literal-space arguments only', () => {
  expect(compactInstructions('/compact')).toBe('');
  expect(compactInstructions('/compact  retain open tasks \n')).toBe('retain open tasks');
  for (const value of ['/Compact', ' /compact', '/compactness', '/compact\tretain']) expect(compactInstructions(value)).toBeNull();
  expect(compactSubmissionError(true, true)).toBe('Remove images to use /compact');
  expect(compactSubmissionError(false, true)).toBe('Wait for queued image messages to send before using /compact');
  expect(compactSubmissionError(false, false)).toBeNull();
  expect(queuedText({steering: [{text: 'First'}, {text: 'Second'}], followUp: [{text: 'Third'}]})).toBe('First\n\nSecond\n\nThird');
});

test('wire failure is suppressed after a new lifecycle notice but existing lifecycle ids stay stable', () => {
  const previous = foldCompactionEvent([], {type: 'compaction_start', reason: 'manual'});
  const observed = compactionIds(previous);
  const fresh = foldCompactionEvent(previous, {type: 'compaction_start', reason: 'manual'});
  const settled = foldCompactionEvent(fresh, {type: 'compaction_end', reason: 'manual', aborted: false, willRetry: false, result: undefined, errorMessage: 'Pi failure'});
  expect(settled[1].compactionId).toBe(fresh[1].compactionId);
  expect(appendCompactionFailure(settled, observed, 'Wire failure')).toBe(settled);
  expect(appendCompactionFailure(previous, observed, 'Queue failure').at(-1).compaction).toEqual({status: 'failed', detail: 'Queue failure'});
});

test('canonical refresh rejects changed contexts, crossed events and streaming snapshots', () => {
  const before = {workspaceId: 'w', sessionId: 's', generation: 1, revision: 3, connected: true, streaming: false};
  expect(transcriptSyncDecision(before, {...before}, false)).toBe('apply');
  expect(transcriptSyncDecision(before, {...before, revision: 4}, false)).toBe('retry');
  expect(transcriptSyncDecision(before, {...before, streaming: true}, false)).toBe('wait');
  expect(transcriptSyncDecision(before, before, true)).toBe('wait');
  for (const patch of [{sessionId: 'other'}, {workspaceId: 'other'}, {generation: 2}, {connected: false}]) expect(transcriptSyncDecision(before, {...before, ...patch}, false)).toBe('stale');
});

test('canonical summaries preserve matched live after-counts without importing stale counts', () => {
  const live = [{role: 'compactionNotice', compaction: {status: 'done', tokensBefore: 2000, tokensAfter: 300, resuming: true}}];
  const canonical = [{role: 'compactionSummary', tokensBefore: 2000, summary: 'Pi summary'}, {role: 'user', content: 'New message'}];
  const merged = reconcileCompactionMessages(live, canonical);
  expect(merged[0].compaction).toEqual({status: 'done', tokensBefore: 2000, tokensAfter: 300, summary: 'Pi summary'});
  expect(merged[1]).toBe(canonical[1]);
  expect(reconcileCompactionMessages([{...live[0], compaction: {...live[0].compaction, tokensBefore: 9000}}], canonical)).toBe(canonical);
});
