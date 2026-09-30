import {expect, test} from 'bun:test';
import {nameChatCommand, nameChatCommandTitle, prepareChatRename} from './nameChatCommand';

test('/name uses the original exact-space parser', () => {
  expect(nameChatCommandTitle('/name')).toBe('');
  expect(nameChatCommandTitle('/name  A\nB ')).toBe(' A\nB ');
  for (const text of ['/Name title', '/names title', '/name\ttitle', ' /name title', 'please /name title']) expect(nameChatCommandTitle(text)).toBeNull();
});

test('rename normalizes newlines and trims while preserving interior spaces', () => {
  expect(prepareChatRename('  A\r\nB  C  ', false)).toEqual({title: 'A B  C'});
  expect(prepareChatRename('x'.repeat(80), false)).toEqual({title: 'x'.repeat(80)});
  expect(prepareChatRename('x'.repeat(81), false)).toEqual({reason: 'Keep chat names to 80 characters or fewer.'});
  expect(prepareChatRename(' \n ', false)).toEqual({reason: 'Enter a chat name.'});
});

test('rename rejects attachments before title validation', () => {
  expect(prepareChatRename('', true)).toEqual({reason: 'Remove images to use /name'});
  expect(prepareChatRename('Valid title', true)).toEqual({reason: 'Remove images to use /name'});
  expect(nameChatCommand).toMatchObject({name: 'name', source: 'builtin', sourceInfo: {path: '<builtin:name>', scope: 'temporary'}});
});
