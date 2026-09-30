import {expect, test} from 'bun:test';
import MarkdownIt from 'markdown-it';
import tokensToAST from './node_modules/react-native-markdown-display/src/lib/util/tokensToAST.js';
import {enableTaskLists} from './markdownTasks.ts';

test('task list markers become checkbox state without appearing in text', () => {
  const list = tokensToAST(new MarkdownIt().use(enableTaskLists).parse('- [ ] todo\n- [x] done **bold**\n- plain', {}))[0];
  const [todo, done, plain] = list.children;
  expect(todo.attributes.taskChecked).toBe('false');
  expect(done.attributes.taskChecked).toBe('true');
  expect(plain.attributes.taskChecked).toBeUndefined();
  expect(todo.children[0].children[0].children[0].content).toBe('todo');
  expect(done.children[0].children[0].children[0].content).toBe('done ');
  expect(plain.children[0].children[0].children[0].content).toBe('plain');
});
