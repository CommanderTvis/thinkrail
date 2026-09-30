import {expect, test} from 'bun:test';
import {scrollToMarkdownHeading} from './markdownAnchors.ts';

test('nested heading navigation measures against the document root on each click', () => {
  const root = {};
  let y = 300;
  const targets = [];
  const heading = {measureLayout(relative, success) {targets.push(relative);success(12, y);}};
  const layout = {root, headings: new Map([['section name', heading]])};
  const offsets = [];
  scrollToMarkdownHeading(layout, '#section%20name', offset => offsets.push(offset));
  y = 620;
  scrollToMarkdownHeading(layout, '#section%20name', offset => offsets.push(offset));
  expect(targets).toEqual([root, root]);
  expect(offsets).toEqual([300, 620]);
});

test('late measurement results cannot scroll a replaced or unmounted document', () => {
  for (const change of [layout => {layout.root = null;}, layout => {layout.root = {};},
    layout => {layout.headings.delete('section');}, layout => {layout.headings.set('section', {});}]) {
    let complete;
    const heading = {measureLayout(_relative, success) {complete = success;}};
    const layout = {root: {}, headings: new Map([['section', heading]])};
    const offsets = [];
    scrollToMarkdownHeading(layout, '#section', offset => offsets.push(offset));
    change(layout);
    complete(0, 800);
    expect(offsets).toEqual([]);
  }
});

test('missing, malformed and failed anchors do not scroll', () => {
  const offsets = [];
  const heading = {measureLayout(_relative, _success, failure) {failure();}};
  const layout = {root: {}, headings: new Map([['section', heading]])};
  for (const href of ['#missing', '#%E0%A4%A', '#section']) {
    scrollToMarkdownHeading(layout, href, offset => offsets.push(offset));
  }
  expect(offsets).toEqual([]);
});
