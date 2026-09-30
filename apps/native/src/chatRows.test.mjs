import {expect, test} from 'bun:test';
import {projectChatRows} from './chatRows.ts';

const text = value => ({type: 'text', text: value});
const thinking = value => ({type: 'thinking', thinking: value});
const tool = name => ({type: 'toolCall', id: name, name, arguments: {}});

test('newest first places the latest request rows first without reversing activity steps', () => {
  const messages = [
    {role: 'system', content: 'connected'},
    {role: 'user', content: 'first'},
    {role: 'assistant', content: [thinking('plan'), tool('read'), text('answer one')]},
    {role: 'user', content: 'second'},
    {role: 'assistant', content: [text('answer two')]},
  ];
  const before = JSON.stringify(messages);
  const oldest = projectChatRows(messages, undefined, 'oldest-first');
  const newest = projectChatRows(messages, undefined, 'newest-first');
  expect(newest.map(row => row.id)).toEqual(oldest.map(row => row.id).toReversed());
  expect(newest[0].message.content).toEqual([text('answer two')]);
  expect(newest[3].message.content).toEqual([thinking('plan'), tool('read')]);
  expect(JSON.stringify(messages)).toBe(before);
});

test('consecutive assistant messages keep one chronological activity group', () => {
  const messages = [
    {role: 'user', content: 'question'},
    {role: 'assistant', content: [thinking('plan'), tool('read')]},
    {role: 'assistant', content: [tool('edit'), text('done')]},
  ];
  const newest = projectChatRows(messages, undefined, 'newest-first');
  expect(newest).toHaveLength(3);
  expect(newest[1].message.content).toEqual([thinking('plan'), tool('read'), tool('edit')]);
});

test('live output occupies the newest edge in either order and is marked only once', () => {
  const messages = [{role: 'user', content: 'question'}, {role: 'assistant', content: [thinking('plan')]}];
  const live = {role: 'assistant', content: [tool('read'), text('partial answer')]};
  const oldest = projectChatRows(messages, live, 'oldest-first');
  const newest = projectChatRows(messages, live, 'newest-first');
  expect(oldest.at(-1).streaming).toBe(true);
  expect(newest[0].streaming).toBe(true);
  expect(newest.filter(row => row.streaming)).toHaveLength(1);
  expect(newest[1].message.content).toEqual([thinking('plan'), tool('read')]);
  expect(live).not.toHaveProperty('streaming');
});

test('an empty transcript and a newly started empty stream remain renderable', () => {
  expect(projectChatRows([], undefined, 'newest-first')).toEqual([]);
  expect(projectChatRows([], {role: 'assistant', content: []}, 'newest-first')).toEqual([
    {id: 'message:0', message: {role: 'assistant', content: []}, streaming: true},
  ]);
});

test('tool results preserve one activity run and stable row identity after hydration', () => {
  const first = {role: 'assistant', content: [thinking('plan'), tool('read')]};
  const second = {role: 'assistant', content: [tool('edit'), text('done')]};
  const result = {role: 'toolResult', toolCallId: 'read', content: [text('file contents')]};
  const live = projectChatRows([first], second, 'oldest-first', true);
  const hydrated = projectChatRows([first, result, second], undefined, 'oldest-first');
  expect(live.map(row => row.id)).toEqual(hydrated.map(row => row.id));
  expect(hydrated).toHaveLength(2);
  expect(hydrated[0].activity).toBe(true);
  expect(hydrated[0].message.content).toEqual([thinking('plan'), tool('read'), tool('edit')]);
});

test('activity stays live between assistant output and tool completion; blank blocks do not split it', () => {
  const messages = [{role: 'assistant', content: [thinking('plan'), text('  '), thinking(''), tool('read')]}];
  const rows = projectChatRows(messages, undefined, 'oldest-first', true);
  expect(rows).toHaveLength(1);
  expect(rows[0].streaming).toBe(true);
  expect(rows[0].message.content).toEqual([thinking('plan'), tool('read')]);
  expect(projectChatRows(messages, undefined, 'oldest-first', false)[0].streaming).toBeUndefined();
});
