import {expect, test} from 'bun:test';
import {compactionState, foldCompactionEvent, formatCompactionTokens} from './compactionModel';
import {projectChatRows} from './chatRows';

const end = overrides => ({type: 'compaction_end', reason: 'manual', aborted: false, willRetry: false, result: undefined, ...overrides});

test('live compaction settles its running notice in place without changing other messages', () => {
  const user = {role: 'user', content: 'Review this'};
  const started = foldCompactionEvent([user], {type: 'compaction_start', reason: 'manual'});
  const finished = foldCompactionEvent(started, end({result: {tokensBefore: 20000, estimatedTokensAfter: 3500}, willRetry: true}));
  expect(finished).toHaveLength(2);
  expect(finished[0]).toBe(user);
  expect(compactionState(finished[1])).toMatchObject({status: 'done', tokensBefore: 20000, tokensAfter: 3500, resuming: true});
  expect(compactionState(started[1])).toEqual({status: 'running'});
  const resumed = foldCompactionEvent(finished, {type: 'agent_start'});
  expect(compactionState(resumed[1]).resuming).toBe(false);
  expect(compactionState(finished[1]).resuming).toBe(true);
});

test('abort wins over errors and a missed start still produces one settled notice', () => {
  expect(compactionState(foldCompactionEvent([], end({aborted: true, errorMessage: 'Provider error'}))[0])).toEqual({status: 'cancelled'});
  expect(compactionState(foldCompactionEvent([], end({errorMessage: 'Provider error'}))[0])).toEqual({status: 'failed', detail: 'Provider error'});
  const done = foldCompactionEvent([], end({result: {tokensBefore: 0, estimatedTokensAfter: 0}}));
  expect(compactionState(done[0])).toMatchObject({status: 'done', tokensBefore: 0, tokensAfter: 0});
  expect(foldCompactionEvent(done, {type: 'agent_start'})).toBe(done);
});

test('hydrated summaries keep Pi text and counts and remain between chronological messages', () => {
  const summary = {role: 'compactionSummary', summary: '# Retained context\n\nExact Pi summary.', tokensBefore: 12500};
  expect(compactionState(summary)).toEqual({status: 'done', summary: summary.summary, tokensBefore: 12500});
  const messages = [{role: 'user', content: 'Before'}, summary, {role: 'assistant', content: [{type: 'text', text: 'After'}]}];
  const rows = projectChatRows(messages, undefined, 'oldest-first');
  expect(rows.map(row => row.message.role)).toEqual(['user', 'compactionSummary', 'assistant']);
  expect(projectChatRows(messages, undefined, 'newest-first').map(row => row.id)).toEqual(rows.map(row => row.id).reverse());
  expect(compactionState(messages[0])).toBeUndefined();
});

test('token labels match the original compact formatting boundaries', () => {
  expect([0, 999, 1000, 9999, 10000, 999999, 1000000, 10000000].map(formatCompactionTokens)).toEqual(['0', '999', '1.0k', '10.0k', '10k', '1000k', '1.0M', '10M']);
});
