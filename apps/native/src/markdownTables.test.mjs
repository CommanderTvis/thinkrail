import {expect, test} from 'bun:test';
import MarkdownIt from 'markdown-it';
import tokensToAST from './node_modules/react-native-markdown-display/src/lib/util/tokensToAST.js';
import {tableColumnWidths} from './markdownTables.ts';

test('table columns share widths across header and body while long content stays scrollable', () => {
  const markdown = '| Name | Summary |\n| --- | --- |\n| ThinkRail | Short |\n| RN | A very long explanation that should not make the table unbounded |';
  const table = tokensToAST(new MarkdownIt().parse(markdown, {}))[0];
  expect(tableColumnWidths(table)).toEqual([87, 320]);
});
