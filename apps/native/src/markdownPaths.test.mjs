import {expect, test} from 'bun:test';
import {classifyHref, resolveRelativePath} from './markdownPaths.ts';
import {stripFrontmatter} from './frontmatter.ts';

test('document links and images resolve within their own workspace', () => {
  expect(resolveRelativePath('docs/deep/guide.md', '../figures/a%20b.png#caption')).toBe('docs/figures/a b.png');
  expect(resolveRelativePath('docs/guide.md', '/README.md?raw=1')).toBe('README.md');
  expect(resolveRelativePath('docs/guide.md', '..\\README.md')).toBe('README.md');
  expect(resolveRelativePath('guide.md', './part.md')).toBe('part.md');
});

test('invalid paths never escape the workspace', () => {
  expect(resolveRelativePath('docs/guide.md', '../../outside.md')).toBeNull();
  expect(resolveRelativePath('docs/guide.md', '%2e%2e/%2e%2e/outside.md')).toBeNull();
  expect(resolveRelativePath('docs/guide.md', '%zz')).toBeNull();
  expect(resolveRelativePath('docs/guide.md', '#section')).toBeNull();
});

test('URL schemes and document anchors are not treated as workspace paths', () => {
  expect(classifyHref('https://example.com')).toBe('external');
  expect(classifyHref('mailto:someone@example.com')).toBe('external');
  expect(classifyHref('//example.com/path')).toBe('external');
  expect(classifyHref('#heading')).toBe('anchor');
  expect(classifyHref('../guide.md')).toBe('relative');
});

test('frontmatter is hidden in the rendered document and template body', () => {
  expect(stripFrontmatter('---\r\ndescription: "Demo"\r\n---\r\n\r\n# Title')).toBe('# Title');
  expect(stripFrontmatter('# Title')).toBe('# Title');
});
