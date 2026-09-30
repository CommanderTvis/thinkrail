import {expect, test} from 'bun:test';
import {keyReviewItems, parseReviewPackage, reviewPackageLabel} from './reviewPackageModel.ts';
import rendererPackage from './review-package-fixture.json';

test('original renderer-output fixture keeps quoted code separate from surrounding context and instructions', () => {
  expect(parseReviewPackage(rendererPackage)).toEqual({count: 1, files: ['src/a.ts'],
    items: [{path: 'src/a.ts', lineRef: 'L2', fragment: 'const two = 2;', body: 'Rename this.'}]});
});

const comment = (id, path, lines, body = 'Rename this.', fragment) => [
  `<comment id="${id}" kind="${path ? 'inline' : 'review'}"${path ? ` path="${path}" side="worktree"` : ''}${lines ? ` lines="${lines}"` : ''} anchor="anchored">`,
  ...(fragment === undefined ? [] : [`<fragment>\n${fragment}\n</fragment>`]),
  `<text>\n${body}\n</text>`, '</comment>',
].join('\n');
const pkg = comments => ['The user left the following review comment. It is a structured review item anchored to the workspace\'s files.', '',
  '<review id="rev_ab12cd34" branch="feature" base="main@deadbeefcafe" comments="1">', '',
  ...comments, '', '<instructions>\nAddress each review comment above.\n</instructions>', '</review>'].join('\n');

test('persisted package preserves the original line reference, remark and quoted fragment', () => {
  const text = pkg([comment('rc_11aa22bb', 'src/a.ts', '2-2', 'Rename this.', 'const two = 2;')]);
  expect(parseReviewPackage(text)).toEqual({count: 1, files: ['src/a.ts'],
    items: [{path: 'src/a.ts', lineRef: 'L2', fragment: 'const two = 2;', body: 'Rename this.'}]});
  expect(reviewPackageLabel(parseReviewPackage(text))).toBe('Sent 1 review comment on src/a.ts');
});

test('summary counts actual parsed comments and distinct files rather than a stale header count', () => {
  const review = parseReviewPackage(pkg([comment('rc_1', 'a.ts'), comment('rc_2', 'a.ts'), comment('rc_3', 'b.md')]));
  expect(review.count).toBe(3);
  expect(review.files).toEqual(['a.ts', 'b.md']);
  expect(reviewPackageLabel(review)).toBe('Sent 3 review comments on 2 files');
});

test('multiline remarks and fragments remain verbatim and line ranges use the original en dash', () => {
  const body = '  first line\nsecond line  ';
  const fragment = 'const two = 2;\n\nconst three = 3;';
  const review = parseReviewPackage(pkg([comment('rc_1', 'a.ts', '2-4', body, fragment)]));
  expect(review.items[0]).toEqual({path: 'a.ts', lineRef: 'L2–4', body, fragment});
});

test('anchorless review comments and missing fragments remain readable', () => {
  const review = parseReviewPackage(pkg([comment('rc_1', undefined, undefined, 'Review the whole change.')]));
  expect(review.items).toEqual([{path: null, lineRef: '', fragment: null, body: 'Review the whole change.'}]);
  expect(reviewPackageLabel(review)).toBe('Sent 1 review comment on the change set');
});

test('ordinary text, inline quoted markup, empty packages, and malformed headers remain plain user messages', () => {
  for (const text of ['please fix the tests', 'see `<review id="rev_x" comments="1">` in the docs', pkg([]),
    pkg([comment('rc_1', 'a.ts')]).replace('comments="1"', 'comments="many"')]) {
    expect(parseReviewPackage(text)).toBeNull();
  }
});

test('duplicate comments have independent stable fold keys and their source items are unchanged', () => {
  const review = parseReviewPackage(pkg([comment('rc_1', 'a.ts', '2-2'), comment('rc_2', 'a.ts', '2-2'), comment('rc_3', 'a.ts', '3-3')]));
  const before = JSON.stringify(review);
  const keyed = keyReviewItems(review.items);
  expect(new Set(keyed.map(value => value.key)).size).toBe(3);
  expect(keyed.map(value => value.key)).toEqual(keyReviewItems(review.items).map(value => value.key));
  expect(keyed.map(value => value.item)).toEqual(review.items);
  expect(JSON.stringify(review)).toBe(before);
});
