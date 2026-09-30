import {expect, test} from 'bun:test';
import {resourceGroups, resourcesLabel} from './resourceGroups.ts';

const command = (id, status) => ({id, sessionId: 's', name: id, command: id, status, startedAt: 0});
const child = (id, status) => ({childSessionId: id, parentSessionId: 's', task: id, status, createdAt: ''});

test('stopping commands and queued subagents stay active until the host reports a terminal state', () => {
  const groups = resourceGroups({workspaceId: 'w', sessionId: 's',
    commands: [command('a', 'running'), command('b', 'stopping'), command('c', 'completed'), command('d', 'stopped'), command('e', 'error')],
    subagents: [child('q', 'queued'), child('r', 'running'), child('done', 'completed'), child('x', 'aborted')]});
  expect(groups.commands.map(item => item.id)).toEqual(['a', 'b']);
  expect(groups.finishedCommands.map(item => item.id)).toEqual(['c', 'd', 'e']);
  expect(groups.subagents.map(item => item.childSessionId)).toEqual(['q', 'r']);
  expect(groups.finishedSubagents.map(item => item.childSessionId)).toEqual(['done', 'x']);
});

test('an unread snapshot groups to nothing and labels its count as unavailable', () => {
  expect(resourceGroups(null)).toEqual({commands: [], subagents: [], finishedCommands: [], finishedSubagents: []});
  expect(resourcesLabel(null)).toBe('Resources, active count unavailable');
  expect(resourcesLabel(0)).toBe('Resources, 0 active');
});
