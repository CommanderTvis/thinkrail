import {expect, test} from 'bun:test';
import {attachmentImageSize, parseToolResultContent, toolImageSize} from './toolResultContent.ts';

test('mixed canonical content preserves image order and exact text without serializing image bytes', () => {
  const first = {type: 'image', data: 'first', mimeType: 'image/png'};
  const second = {type: 'image', data: 'second', mimeType: 'image/jpeg'};
  const result = {content: [{type: 'text', text: 'one\n'}, first, {type: 'text', text: 'two'}, second]};
  const before = JSON.stringify(result);
  expect(parseToolResultContent(result)).toEqual({text: 'one\ntwo', images: [first, second]});
  expect(JSON.stringify(result)).toBe(before);
});

test('only nonempty supported raster image blocks become previews', () => {
  const supported = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const content = supported.map(mimeType => ({type: 'image', data: 'bytes', mimeType}));
  content.push(null, 'text', {type: 'image', data: '', mimeType: 'image/png'},
    {type: 'image', data: 'svg', mimeType: 'image/svg+xml'}, {type: 'image', data: 123, mimeType: 'image/png'},
    {type: 'image', data: 'unknown'}, {type: 'text', text: 123});
  expect(parseToolResultContent({content})).toEqual({text: '', images: content.slice(0, 4)});
});

test('fallback output retains strings and structured noncanonical values', () => {
  expect(parseToolResultContent(null)).toEqual({text: '', images: []});
  expect(parseToolResultContent('plain output')).toEqual({text: 'plain output', images: []});
  expect(parseToolResultContent({exitCode: 1}).text).toBe('{\n  "exitCode": 1\n}');
  expect(parseToolResultContent({content: []})).toEqual({text: '', images: []});
});

test('thumbnail geometry fits both width and 240-point height without upscaling', () => {
  expect(toolImageSize({width: 1200, height: 600}, 320)).toEqual({width: 320, height: 160});
  expect(toolImageSize({width: 400, height: 1200}, 320)).toEqual({width: 80, height: 240});
  expect(toolImageSize({width: 32, height: 16}, 320)).toEqual({width: 32, height: 16});
  expect(toolImageSize({width: 1200, height: 600}, 0)).toEqual({width: 0, height: 0});
});

test('attachment previews fit the original viewport caps and dialog chrome without upscaling', () => {
  expect(attachmentImageSize({width: 32, height: 16}, {width: 1000, height: 800})).toEqual({width: 32, height: 16});
  expect(attachmentImageSize({width: 2000, height: 1000}, {width: 1000, height: 800})).toEqual({width: 918, height: 459});
  expect(attachmentImageSize({width: 400, height: 1600}, {width: 1000, height: 800})).toEqual({width: 160, height: 640});
  const narrow = attachmentImageSize({width: 100, height: 1000}, {width: 400, height: 400});
  expect(narrow.width).toBeCloseTo(30.25);
  expect(narrow.height).toBe(302.5);
});
