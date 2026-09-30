import {expect, test} from 'bun:test';
import MarkdownIt from 'markdown-it';
import parseNative from 'react-native-markdown-display/src/lib/parser.js';
import {enableGithubAlerts} from './markdownAlerts.ts';
import {enableTaskLists} from './markdownTasks.ts';
import {collapsedBlockMargins, enableParagraphSpacing, inlineCodeSize, listMarker, markdownContent, markdownOptions, paragraphMargin} from './markdownFormatting.ts';

test('only direct chat table code uses the original smaller typography', () => {
  const wrappers = [{type: 'textgroup'}, {type: 'inline'}];
  for (const type of ['td', 'th']) {
    expect(inlineCodeSize(false, [...wrappers, {type}])).toEqual({fontSize: 11, lineHeight: 16.5});
    expect(inlineCodeSize(true, [...wrappers, {type}])).toEqual({fontSize: 13, lineHeight: 20});
    expect(inlineCodeSize(false, [{type: 'strong'}, ...wrappers, {type}])).toEqual({fontSize: 13, lineHeight: 20});
  }
  expect(inlineCodeSize(false, [...wrappers, {type: 'paragraph'}])).toEqual({fontSize: 13, lineHeight: 20});
});

test('tight-list paragraph flags survive the parser while loose paragraphs retain their spacing', () => {
  const parser = new MarkdownIt(markdownOptions).use(enableParagraphSpacing);
  const paragraphs = text => parser.parse(text, {}).filter(token => token.type === 'paragraph_open' || token.type === 'list_paragraph_open');
  expect(paragraphs('- one\n- two').map(token => token.attrGet('tight'))).toEqual(['true', 'true']);
  expect(paragraphs('- one\n\n- two').map(token => token.attrGet('tight'))).toEqual([null, null]);
  expect(paragraphs('- parent\n  1. child\n  2. child').map(token => token.attrGet('tight'))).toEqual(['true', 'true', 'true']);
  expect(paragraphs('- parent\n\n  3. child\n  4. child').map(token => token.attrGet('tight'))).toEqual([null, 'true', 'true']);
  expect(paragraphs('ordinary prose')[0].attrGet('tight')).toBeNull();
});

test('native parser retains first paragraphs of loose lists instead of deleting their margins', () => {
  const parser = new MarkdownIt(markdownOptions).use(enableParagraphSpacing);
  const ast = parseNative('- one\n\n- two', nodes => nodes, parser);
  expect(ast[0].children.map(item => item.children[0].type)).toEqual(['list_paragraph', 'list_paragraph']);
  expect(ast[0].children.map(item => item.children[0].attributes.tight)).toEqual([undefined, undefined]);
  const tight = parseNative('- one\n- two', nodes => nodes, parser);
  expect(tight[0].children.map(item => item.children[0].attributes.tight)).toEqual(['true', 'true']);
});

test('list paragraphs preserve nested callouts and task state through the real native parser', () => {
  const parser = new MarkdownIt(markdownOptions).use(enableGithubAlerts).use(enableTaskLists).use(enableParagraphSpacing);
  const ast = parseNative('- parent\n\n  > [!NOTE]\n  > Body\n\n- [x] done', nodes => nodes, parser);
  const nodes = [];
  const visit = node => {nodes.push(node);node.children.forEach(visit);};
  ast.forEach(visit);
  expect(nodes.find(node => node.type === 'blockquote').attributes.alert).toBe('note');
  expect(nodes.filter(node => node.type === 'list_item').at(-1).attributes.taskChecked).toBe('true');
  expect(nodes.some(node => node.type === 'text' && (node.content.includes('[!NOTE]') || node.content.includes('[x]')))).toBe(false);
});

test('nearest list determines marker kind and authored starting number', () => {
  const bullet = {type: 'bullet_list'};
  const ordered = {type: 'ordered_list', attributes: {start: '3'}};
  expect(listMarker(0, [ordered, {type: 'list_item'}, bullet])).toBe('3.');
  expect(listMarker(1, [ordered, bullet])).toBe('4.');
  expect(listMarker(0, [bullet, ordered])).toBe('•');
  expect(listMarker(0, [{type: 'ordered_list'}])).toBe('1.');
  expect(listMarker(0, [{type: 'ordered_list', attributes: {start: '0'}}])).toBe('0.');
});

test('document lists and alerts use compact paragraphs while chat retains its own spacing', () => {
  const list = [{type: 'list_item'}];
  const alert = [{type: 'blockquote', attributes: {alert: 'note'}}];
  expect(paragraphMargin(true, true, list)).toBe(0);
  expect(paragraphMargin(false, true, list)).toBe(0);
  expect(paragraphMargin(true, false, list)).toBe(4);
  expect(paragraphMargin(false, false, list)).toBe(8);
  expect(paragraphMargin(true, false, alert)).toBe(4);
  expect(paragraphMargin(true, false, [{type: 'blockquote'}])).toBe(12);
  expect(paragraphMargin(true, false, [])).toBe(12);
});

test('authored punctuation stays literal and bare GFM URLs become links', () => {
  const inline = new MarkdownIt(markdownOptions).parse('"quoted" -- ... https://example.com/path', {})[1];
  expect(inline.children[0].content).toBe('"quoted" -- ... ');
  expect(inline.children.find(token => token.type === 'link_open').attrGet('href')).toBe('https://example.com/path');
});

test('frontmatter is stripped from documents and retained in chat', () => {
  const source = '---\ntitle: Test\n---\n\n# Body';
  expect(markdownContent(source, true)).toBe('# Body');
  expect(markdownContent(source, false)).toBe(source);
});

test('native block gaps collapse like document margins without adding adjacent paragraph margins', () => {
  const margins = collapsedBlockMargins([{top: 12, bottom: 12}, {top: 12, bottom: 12}, {top: 24, bottom: 12}], true, true);
  expect(margins).toEqual([{marginTop: 0, marginBottom: 12}, {marginTop: 0, marginBottom: 12}, {marginTop: 12, marginBottom: 0}]);
  expect(margins[0].marginBottom + margins[1].marginTop).toBe(12);
  expect(margins[1].marginBottom + margins[2].marginTop).toBe(24);
});

test('flow retains chat edge space and supports a single trimmed final block', () => {
  expect(collapsedBlockMargins([{top: 8, bottom: 8}], false, false)).toEqual([{marginTop: 8, marginBottom: 8}]);
  expect(collapsedBlockMargins([{top: 12, bottom: 12}], true, true)).toEqual([{marginTop: 0, marginBottom: 0}]);
  expect(collapsedBlockMargins([], true, true)).toEqual([]);
});
