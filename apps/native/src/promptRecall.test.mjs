import {expect, test} from 'bun:test';
import {recentChatPrompts, promptRecallIndex, promptRecallStep} from './promptRecall.ts';

test('recall reads exact canonical user text, newest first, without attachments or assistant text', () => {
  const messages = [
    {role: 'user', content: 'first'},
    {role: 'assistant', content: 'not a prompt'},
    {role: 'user', content: [{type: 'text', text: 'line one'}, {type: 'image', data: 'bytes'}, {type: 'text', text: 'line two'}]},
    {role: 'user', content: 'first'},
    {role: 'user', content: [{type: 'image', data: 'bytes'}]},
    {role: 'user', content: '  exact whitespace  '},
  ];
  expect(recentChatPrompts(messages)).toEqual(['  exact whitespace  ', 'first', 'line one\nline two']);
  expect(messages[0].content).toBe('first');
});

test('Up clamps at oldest and Down returns to the empty draft', () => {
  const prompts = ['newest', 'oldest'];
  expect(promptRecallStep('ArrowUp', '', null, prompts)).toEqual({index: 0, text: 'newest'});
  expect(promptRecallStep('ArrowUp', 'newest', 0, prompts)).toEqual({index: 1, text: 'oldest'});
  expect(promptRecallStep('ArrowUp', 'oldest', 1, prompts)).toEqual({index: 1, text: 'oldest'});
  expect(promptRecallStep('ArrowDown', 'oldest', 1, prompts)).toEqual({index: 0, text: 'newest'});
  expect(promptRecallStep('ArrowDown', 'newest', 0, prompts)).toEqual({index: null, text: ''});
});

test('ordinary draft movement and empty history stay native', () => {
  expect(promptRecallStep('ArrowUp', 'my unsent draft', null, ['history'])).toBeNull();
  expect(promptRecallStep('ArrowDown', 'my unsent draft', null, ['history'])).toBeNull();
  expect(promptRecallStep('ArrowUp', '', null, [])).toBeNull();
  expect(promptRecallStep('Enter', '', null, ['history'])).toBeNull();
});

test('recall cursor cannot cross chats, edited drafts or changed history', () => {
  const cursor = {context: 'workspace-a/chat-a', index: 0};
  expect(promptRecallIndex(cursor, cursor.context, 'same prompt', ['same prompt'])).toBe(0);
  expect(promptRecallIndex(cursor, 'workspace-a/chat-b', 'same prompt', ['same prompt'])).toBeNull();
  expect(promptRecallIndex(cursor, cursor.context, 'edited prompt', ['same prompt'])).toBeNull();
  expect(promptRecallIndex(cursor, cursor.context, 'same prompt', ['new prompt', 'same prompt'])).toBeNull();
  expect(promptRecallIndex(null, cursor.context, 'same prompt', ['same prompt'])).toBeNull();
});
