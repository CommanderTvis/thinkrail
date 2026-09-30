import {expect, test} from 'bun:test';
import {parseSkillInvocation} from './skillInvocation.ts';
import {projectChatRows} from './chatRows.ts';
import {chatMessageText, reconcileUserMessage} from './messageActionModel.ts';

const expanded = '<skill name="review" location="/repo/.pi/skills/review/SKILL.md">\nReferences are relative to /repo/.pi/skills/review.\n\n# Review\n\nInspect the complete diff.\n</skill>\n\nFocus on src/app.ts.\nThen run tests.';

test('canonical Pi instructions and user request remain separate and preserve Markdown source', () => {
  expect(parseSkillInvocation(expanded)).toEqual({name: 'review', location: '/repo/.pi/skills/review/SKILL.md',
    content: 'References are relative to /repo/.pi/skills/review.\n\n# Review\n\nInspect the complete diff.',
    userMessage: 'Focus on src/app.ts.\nThen run tests.'});
});

test('instructions without a request or with blank trailing text need no empty request bubble', () => {
  const canonical = '<skill name="todos" location="/skills/todos/SKILL.md">\nKeep the plan current.\n</skill>';
  expect(parseSkillInvocation(canonical)).toEqual({name: 'todos', location: '/skills/todos/SKILL.md', content: 'Keep the plan current.'});
  expect(parseSkillInvocation(canonical + '\n\n  \n ')).not.toHaveProperty('userMessage');
  expect(parseSkillInvocation(canonical + '\n\n  request\nline two  ').userMessage).toBe('request\nline two');
});

test('quoted, prefixed, malformed, and ordinary input cannot hide as a skill card', () => {
  for (const value of ['please review this', `Quoted: ${expanded}`, `prefix\n${expanded}`, expanded.replace('</skill>', '</skill-missing>'),
    expanded.replace('name="review"', 'name=""'), expanded.replace('location="/repo/.pi/skills/review/SKILL.md"', '')]) {
    expect(parseSkillInvocation(value)).toBeNull();
  }
});

test('canonical skill identity and request survive message-block joining and presentation reversal', () => {
  const messages = [{role: 'user', content: [{type: 'text', text: expanded.slice(0, 55)}, {type: 'text', text: expanded.slice(55)}]},
    {role: 'assistant', content: [{type: 'text', text: 'answer'}]}];
  const oldest = projectChatRows(messages, undefined, 'oldest-first');
  const newest = projectChatRows(messages, undefined, 'newest-first');
  expect(oldest[0].id).toBe(newest[1].id);
  expect(parseSkillInvocation(chatMessageText(oldest[0].message))).toEqual(parseSkillInvocation(chatMessageText(newest[1].message)));
  expect(chatMessageText(messages[0])).toBe(expanded);
});

test('a matching expanded skill echo replaces the raw command in its existing row', () => {
  const canonical = {role: 'user', content: [{type: 'text', text: expanded}]};
  const pending = [{role: 'assistant', content: 'previous'}, {role: 'user', content: '/skill:review  Focus on src/app.ts.\nThen run tests.  '}];
  const reconciled = reconcileUserMessage(pending, canonical);
  expect(reconciled).toHaveLength(2);
  expect(reconciled[1]).toBe(canonical);
  expect(pending[1].content).toStartWith('/skill:');
  expect(projectChatRows(reconciled, undefined, 'oldest-first')[1].id).toBe(projectChatRows(pending, undefined, 'oldest-first')[1].id);
  expect(reconcileUserMessage(reconciled, canonical)).toBe(reconciled);
});

test('different skills, requests, and intervening assistant content cannot consume a canonical skill message', () => {
  const canonical = {role: 'user', content: expanded};
  for (const command of ['/skill:other Focus on src/app.ts.\nThen run tests.', '/skill:review different request', 'review Focus on src/app.ts.\nThen run tests.']) {
    expect(reconcileUserMessage([{role: 'user', content: command}], canonical)).toHaveLength(2);
  }
  expect(reconcileUserMessage([{role: 'user', content: '/skill:review Focus on src/app.ts.\nThen run tests.'}, {role: 'assistant', content: 'in between'}], canonical)).toHaveLength(3);
  const noRequest = {role: 'user', content: '<skill name="todos" location="/skills/todos/SKILL.md">\nbody\n</skill>'};
  expect(reconcileUserMessage([{role: 'user', content: '/skill:todos '}], noRequest)).toEqual([noRequest]);
});
