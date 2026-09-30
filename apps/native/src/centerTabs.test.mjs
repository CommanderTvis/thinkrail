import {expect, test} from 'bun:test';
import {closeCenterTab, emptyCenterTabs, openCenterTab, selectCenterTab} from './centerTabs.ts';

test('opening resources keeps earlier tabs and reuses an existing tab', () => {
  const first = {id: 'file:a.md', kind: 'editor', path: 'a.md'};
  const second = {id: 'file:b.md', kind: 'editor', path: 'b.md'};
  const opened = openCenterTab(openCenterTab(emptyCenterTabs(), first), second);
  expect(opened.tabs.map(tab => tab.id)).toEqual(['file:a.md', 'file:b.md']);
  expect(openCenterTab(opened, first)).toEqual({tabs: [first, second], activeId: first.id});
});

test('closing one tab activates its neighbor and preserves the rest', () => {
  const a = {id: 'file:a.md', kind: 'editor', path: 'a.md'};
  const b = {id: 'file:b.md', kind: 'editor', path: 'b.md'};
  const chat = {id: 'chat:s1', kind: 'chat', sessionId: 's1'};
  const opened = openCenterTab(openCenterTab(openCenterTab(emptyCenterTabs(), a), b), chat);
  const selected = selectCenterTab(opened, b.id);
  expect(closeCenterTab(selected, b.id)).toEqual({tabs: [a, chat], activeId: chat.id});
  expect(closeCenterTab(selected, a.id)).toEqual({tabs: [b, chat], activeId: b.id});
  expect(closeCenterTab({tabs: [a], activeId: a.id}, a.id)).toEqual(emptyCenterTabs());
});

test('each chat session keeps its own tab and can be selected again', () => {
  const first = {id: 'chat:s1', kind: 'chat', sessionId: 's1'};
  const second = {id: 'chat:s2', kind: 'chat', sessionId: 's2'};
  const opened = openCenterTab(openCenterTab(emptyCenterTabs(), first), second);
  expect(opened.tabs).toEqual([first, second]);
  expect(selectCenterTab(opened, first.id).activeId).toBe(first.id);
  expect(closeCenterTab(opened, second.id)).toEqual({tabs: [first], activeId: first.id});
});

test('separate host terminal keys occupy separate center tabs', () => {
  const first = {id: 'terminal:t1', kind: 'terminal', tabKey: 't1'};
  const second = {id: 'terminal:t2', kind: 'terminal', tabKey: 't2'};
  const opened = openCenterTab(openCenterTab(emptyCenterTabs(), first), second);
  expect(opened.tabs).toEqual([first, second]);
  expect(selectCenterTab(opened, first.id).activeId).toBe(first.id);
  expect(closeCenterTab(opened, second.id)).toEqual({tabs: [first], activeId: first.id});
});
