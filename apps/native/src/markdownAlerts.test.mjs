import {expect, test} from 'bun:test';
import MarkdownIt from 'markdown-it';
import {enableGithubAlerts} from './markdownAlerts.ts';

test('document alert markers become blockquote attributes without leaking marker text', () => {
  const markdown = new MarkdownIt().use(enableGithubAlerts);
  const tokens = markdown.parse('> [!NOTE]\n> A **useful** detail.\n\n> [!CAUTION] Keep backups.\n\n> Ordinary quote.', {});
  const quotes = tokens.filter(token => token.type === 'blockquote_open');
  expect(quotes.map(token => token.attrGet('alert'))).toEqual(['note', 'caution', null]);
  expect(tokens.filter(token => token.type === 'inline').map(token => token.children.map(child => child.content).join('')))
    .toEqual(['A useful detail.', 'Keep backups.', 'Ordinary quote.']);
});

test('an alert marker on its own paragraph does not leave an empty paragraph', () => {
  const tokens = new MarkdownIt().use(enableGithubAlerts).parse('> [!TIP]\n>\n> Do this.', {});
  expect(tokens.filter(token => token.type === 'blockquote_open')[0].attrGet('alert')).toBe('tip');
  expect(tokens.filter(token => token.type === 'paragraph_open')).toHaveLength(1);
  expect(tokens.filter(token => token.type === 'inline')[0].content).toBe('Do this.');
});
