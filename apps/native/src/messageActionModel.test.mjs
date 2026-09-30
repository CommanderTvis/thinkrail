import {expect, test} from 'bun:test';
import {projectChatRows} from './chatRows.ts';
import {chatMessageAttachments, chatMessageText, messageActions} from './messageActionModel.ts';

const text = value => ({type: 'text', text: value});
const tool = {type: 'toolCall', id: 'read-1', name: 'read', arguments: {path: 'README.md'}};
const rows = (messages, live) => projectChatRows(messages, live, 'oldest-first');

test('hydrated attachments preserve image order and duplicate identities without inventing filenames', () => {
  const first = {type: 'image', data: 'same-bytes', mimeType: 'image/png'};
  const second = {type: 'image', data: 'second-image', mimeType: 'image/jpeg'};
  const content = [text('question'), first, second, {...first}];
  const before = JSON.stringify(content);
  const attachments = chatMessageAttachments(content);
  expect(attachments.map(value => value.image)).toEqual([first, second, first]);
  expect(attachments.map(value => value.label)).toEqual(['image/png', 'image/jpeg', 'image/png']);
  expect(new Set(attachments.map(value => value.key)).size).toBe(3);
  expect(chatMessageAttachments(content).map(value => value.key)).toEqual(attachments.map(value => value.key));
  expect(chatMessageText({role: 'user', content})).toBe('question');
  expect(JSON.stringify(content)).toBe(before);
});

test('image-only messages remain attachments without displaying or copying image bytes as text', () => {
  const content = [{type: 'image', data: 'image-bytes', mimeType: 'image/webp'}, null,
    {type: 'image', data: '', mimeType: 'image/png'}, {type: 'image', data: 'svg', mimeType: 'image/svg+xml'}];
  expect(chatMessageAttachments(content)).toHaveLength(1);
  expect(chatMessageText({role: 'user', content})).toBe('');
  expect(chatMessageAttachments('ordinary text')).toEqual([]);
  expect(chatMessageAttachments(undefined)).toEqual([]);
});

test('copy preserves exact source text across text blocks without including activity or image data', () => {
  expect(chatMessageText({role: 'user', content: '  source\n'})).toBe('  source\n');
  expect(chatMessageText({role: 'assistant', content: [text('one'), tool, text('\ntwo'), {type: 'image', data: 'private'}]})).toBe('one\ntwo');
  expect(chatMessageText({role: 'system', summary: 'summary'})).toBe('summary');
});

test('only the concluding answer in each round gets a copy action', () => {
  const chronological = rows([
    {role: 'user', content: 'first'},
    {role: 'assistant', content: [text('checking'), tool, text('first answer')]},
    {role: 'user', content: 'second'},
    {role: 'assistant', content: [text('second answer')]},
    {role: 'user', content: 'third'},
  ]);
  const actions = messageActions(chronological, false);
  expect([...actions.finalAnswers]).toEqual(['message:3:0', 'message:1:2']);
  expect(actions.responded.get('message:0')).toBe(true);
  expect(actions.responded.get('message:2')).toBe(true);
  expect(actions.responded.get('message:4')).toBe(false);
  const newest = [...chronological].reverse();
  expect(newest.filter(row => actions.finalAnswers.has(row.id)).map(row => row.id)).toEqual(['message:3:0', 'message:1:2']);
  expect(chronological[0].id).toBe('message:0');
});

test('narration followed by a tool run is not classified as a concluding answer', () => {
  const chronological = rows([
    {role: 'user', content: 'inspect'},
    {role: 'assistant', content: [text('I will read it.'), tool]},
    {role: 'toolResult', toolCallId: tool.id, content: [text('file')]},
  ]);
  const actions = messageActions(chronological, false);
  expect(actions.finalAnswers.size).toBe(0);
  expect(actions.responded.get('message:0')).toBe(true);
});

test('starting a stream collapses the latest request even before output, while earlier unanswered requests stay expanded', () => {
  const chronological = rows([{role: 'user', content: 'earlier'}, {role: 'user', content: 'latest'}], {role: 'assistant', content: []});
  const idle = messageActions(chronological, false);
  const running = messageActions(chronological, true);
  expect(idle.responded.get('message:1')).toBe(false);
  expect(running.responded.get('message:1')).toBe(true);
  expect(running.responded.get('message:0')).toBe(false);
  expect(running.finalAnswers.size).toBe(0);
});

test('tool-result hydration and live-to-committed answers preserve action identities', () => {
  const request = {role: 'user', content: 'inspect'};
  const activity = {role: 'assistant', content: [tool]};
  const answer = {role: 'assistant', content: [text('done')]};
  const live = messageActions(rows([request, activity], answer), true);
  const committed = messageActions(rows([request, activity, {role: 'toolResult', toolCallId: tool.id, content: [text('file')]}, answer]), false);
  expect([...live.finalAnswers]).toEqual([...committed.finalAnswers]);
  expect([...live.responded]).toEqual([...committed.responded]);
});
