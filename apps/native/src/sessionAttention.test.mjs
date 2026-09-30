import {expect, test} from 'bun:test';
import {isRunning, needsAttention, unreadCompletion} from './sessionAttention.ts';

const record = (sessionId, workspaceId, state) => ({sessionId, workspaceId, projectId: 'p1',
  state: {execution: 'idle', needsInput: null, completion: null, completionUnread: false, ...state}});
const states = Object.fromEntries([
  record('quiet', 'w1', {}),
  record('asking', 'w2', {needsInput: {interactionId: 'i', kind: 'question'}}),
  record('done', 'w3', {completion: {completionId: 'c1', outcome: 'succeeded'}, completionUnread: true}),
  record('read', 'w4', {completion: {completionId: 'c2', outcome: 'succeeded'}}),
  record('busy', 'w4', {execution: 'running'}),
].map(item => [item.sessionId, item]));

test('a pending question or an unread result needs attention; a read result does not', () => {
  expect(needsAttention(states, {workspaceId: 'w1'})).toBe(false);
  expect(needsAttention(states, {workspaceId: 'w2'})).toBe(true);
  expect(needsAttention(states, {workspaceId: 'w3'})).toBe(true);
  expect(needsAttention(states, {workspaceId: 'w4'})).toBe(false);
  expect(needsAttention(states, {projectId: 'p1'})).toBe(true);
  expect(needsAttention(states, {projectId: 'p2'})).toBe(false);
});

test('running is scoped to the workspace or project that owns the session', () => {
  expect(isRunning(states, {workspaceId: 'w4'})).toBe(true);
  expect(isRunning(states, {workspaceId: 'w1'})).toBe(false);
  expect(isRunning(states, {projectId: 'p1'})).toBe(true);
});

test('only an unread completion is offered for acknowledgement', () => {
  expect(unreadCompletion(states, 'done')).toBe('c1');
  expect(unreadCompletion(states, 'read')).toBeUndefined();
  expect(unreadCompletion(states, 'missing')).toBeUndefined();
});
