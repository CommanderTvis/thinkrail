import {expect, test} from 'bun:test';
import MarkdownIt from 'markdown-it';
import {enableHeadingIds, slugifyHeading} from './markdownHeadingIds.ts';

test('heading IDs follow the original slug and duplicate rules', () => {
  expect(slugifyHeading(' Hello, *World*! ')).toBe('hello-world');
  const tokens = new MarkdownIt().use(enableHeadingIds).parse('# Hello *world*!\n\n## Hello world\n\n# Hello world', {});
  expect(tokens.filter(token => token.type === 'heading_open').map(token => token.attrGet('id')))
    .toEqual(['hello-world', 'hello-world-1', 'hello-world-2']);
});

test('heading slugs omit image alt text and preserve soft-break word separation', () => {
  const tokens = new MarkdownIt().use(enableHeadingIds).parse('# Intro ![badge](badge.svg)\n\nHello\nworld\n---\n\n# ![Only image](image.png)', {});
  expect(tokens.filter(token => token.type === 'heading_open').map(token => token.attrGet('id')))
    .toEqual(['intro', 'hello-world', null]);
});
