import {expect, test} from 'bun:test';
import {createCodeHighlighter} from './syntaxHighlighter.ts';
import {createJavaScriptRegexEngine} from 'shiki/engine/javascript';
import {syntaxColor} from './syntaxColors.ts';
import themes from './theme-colors.json';
import generatedTheme from './shiki-theme.json';
import {THINKRAIL_SHIKI_THEME} from '../../../apps/web/src/themes/shiki.ts';
const highlightCode = createCodeHighlighter(createJavaScriptRegexEngine({target: 'ES2018'}));

test('native token theme is generated from the original rather than a second scope map', () => {
  expect(generatedTheme).toEqual(THINKRAIL_SHIKI_THEME);
});

test('syntax highlighting preserves text, empty lines and Unicode while matching keyword and string scopes', async () => {
  const code = 'const greeting = "Привет 👋";\n\n// comment\n';
  const tokens = await highlightCode(code, 'ts');
  expect(tokens).not.toBeNull();
  expect(tokens.map(line => line.map(token => token.content).join('')).join('\n')).toBe(code);
  expect(tokens[0].find(token => token.content === 'const').color).toBe('var(--code-keyword)');
  expect(tokens[2].find(token => token.content.includes('comment')).color).toBe('var(--code-comment)');
  expect(await highlightCode(code, 'TYPESCRIPT')).toEqual(tokens);
});

test('unsupported languages retain the plain-code path', async () => {
  expect(await highlightCode('unknown syntax', 'not-a-language')).toBeNull();
});

test('tokens recolor from the current light/dark/contrast palette without altering source', () => {
  for (const theme of themes) {
    expect(syntaxColor('var(--code-keyword)', theme.syntax)).toBe(theme.syntax.keyword);
    expect(syntaxColor('var(--code-comment-doc)', theme.syntax)).toBe(theme.syntax.commentDoc);
    expect(syntaxColor('var(--code-attribute-name)', theme.syntax)).toBe(theme.syntax.attributeName);
    expect(syntaxColor(undefined, theme.syntax)).toBe(theme.syntax.foreground);
  }
});
