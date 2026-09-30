import {expect, test} from 'bun:test';
import {keyReviewItems, parseReviewFix} from './reviewPackageModel.ts';
import {projectChatRows} from './chatRows.ts';

const message = details => ({role: 'custom', customType: 'todo-review-fix', content: 'Agent instructions',
  details: {itemId: 'todo-1', itemTitle: 'Handle retries', comments: [], ...details}});

test('review-fix cards preserve the requested task, optional note and multiline finding', () => {
  const note = 'Keep the current behavior.\n  Add retry coverage.';
  const body = 'First finding\n  More context';
  expect(parseReviewFix(message({note, comments: [{body, path: 'src/retry.ts', startLine: 2, endLine: 4}]}))).toEqual({
    summary: 'Requested a fix on “Handle retries” · 1 finding', note,
    items: [{path: 'src/retry.ts', lineRef: 'src/retry.ts L2–4', fragment: null, body}],
  });
});

test('note-only requests omit the empty findings count and remain review-fix cards', () => {
  expect(parseReviewFix(message({note: 'Try again.'}))).toEqual({summary: 'Requested a fix on “Handle retries”', note: 'Try again.', items: []});
});

test('pre-resolved locations match the original for single lines, ranges and missing paths', () => {
  const comments = [{body: 'one', path: 'a.ts', startLine: 3}, {body: 'two', path: 'b.ts', startLine: 5, endLine: 5},
    {body: 'three', startLine: 8, endLine: 10}, {body: 'four', path: 'c.ts'}, {body: 'five'}];
  const review = parseReviewFix(message({comments}));
  expect(review.summary).toBe('Requested a fix on “Handle retries” · 5 findings');
  expect(review.items.map(item => item.lineRef)).toEqual(['a.ts L3', 'b.ts L5', 'L8–10', 'c.ts', '']);
  expect(review.items.every(item => item.fragment === null)).toBe(true);
});

test('generic custom messages and malformed review-fix details do not become review cards', () => {
  for (const value of [null, {role: 'user', customType: 'todo-review-fix'}, {...message(), customType: 'other'},
    {...message(), details: null}, message({itemId: 2}), message({itemTitle: null}), message({comments: 'bad'}),
    message({comments: [null]}), message({comments: [{body: 3}]}), message({comments: [{body: 'bad', startLine: '2'}]}),
    message({comments: [{body: 'bad', path: 5}]})]) expect(parseReviewFix(value)).toBeNull();
});

test('duplicate persisted findings keep their order and independent disclosure keys', () => {
  const original = message({comments: [{body: 'Fix this.', path: 'a.ts', startLine: 1}, {body: 'Fix this.', path: 'a.ts', startLine: 1}]});
  const before = JSON.stringify(original);
  const review = parseReviewFix(original);
  expect(new Set(keyReviewItems(review.items).map(item => item.key)).size).toBe(2);
  expect(JSON.stringify(original)).toBe(before);
});

test('review-fix details survive transcript projection alongside ongoing assistant output', () => {
  const fix = message({comments: [{body: 'Fix this.'}]});
  const partial = {role: 'assistant', content: [{type: 'text', text: 'Working…'}]};
  const rows = projectChatRows([fix], partial, 'oldest-first', true);
  expect(parseReviewFix(rows[0].message)?.summary).toBe('Requested a fix on “Handle retries” · 1 finding');
  expect(rows[1].streaming).toBe(true);
  expect(projectChatRows([fix], partial, 'newest-first', true).map(row => row.id)).toEqual(rows.map(row => row.id).reverse());
});
