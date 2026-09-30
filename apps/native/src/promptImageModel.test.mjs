import {expect, test} from 'bun:test';
import {fitPromptImages, imageTransferSources, promptContent, settlePromptImages} from './promptImageModel.ts';
import {reconcileUserMessage} from './messageActionModel.ts';

const image = (id, data = 'aGVsbG8=') => ({id, name: id + '.png', width: 32, height: 16, content: {type: 'image', mimeType: 'image/png', data}});

test('native image transfers preserve copied-file order and accept PNG/TIFF clipboard data', () => {
  expect(imageTransferSources([
    {type: 'image/png', uri: '/Users/user/a.png', name: 'a.png'},
    {type: 'image/jpeg', uri: 'file:///Users/user/b.jpg', name: 'b.jpg'},
    {type: 'image/png', uri: 'data:image/png;base64,aGVsbG8='},
    {type: 'image/tiff', uri: 'data:image/tiff;base64,aGVsbG8='},
  ])).toEqual([
    {uri: '/Users/user/a.png', name: 'a.png'}, {uri: 'file:///Users/user/b.jpg', name: 'b.jpg'},
    {uri: 'data:image/png;base64,aGVsbG8=', name: 'image'}, {uri: 'data:image/tiff;base64,aGVsbG8=', name: 'image'},
  ]);
});

test('ordinary text, non-images and remote or malformed image URIs never enter native preparation', () => {
  expect(imageTransferSources([
    {type: 'text/plain', uri: '/Users/user/readme.txt'}, {type: null, uri: '/Users/user/unknown'},
    {type: 'image/png', uri: null}, {type: 'image/png', uri: 'https://example.com/a.png'},
    {type: 'image/png', uri: 'file://server/share/a.png'}, {type: 'image/png', uri: 'data:image/png,raw'},
  ])).toEqual([]);
});

test('overlapping preparations keep their draft pending until the final operation settles', () => {
  const initial = {images: [image('existing')], errors: [], pending: 2};
  const first = settlePromptImages(initial, {images: [image('first')], errors: []});
  expect(first.pending).toBe(1);
  const final = settlePromptImages(first, {images: [image('second')], errors: []});
  expect(final.pending).toBe(0);
  expect(final.images.map(item => item.id)).toEqual(['existing', 'first', 'second']);
  expect(initial.pending).toBe(2);
});

test('a failed preparation settles only its own operation and retains attachments and earlier errors', () => {
  const earlier = {id: 'earlier', name: 'old.png', reason: 'unsupported'};
  const failure = {id: 'failure', name: 'new.png', reason: 'unsupported'};
  const draft = {images: [image('one')], errors: [earlier], pending: 2};
  expect(settlePromptImages(draft, {images: [], errors: [failure]})).toEqual({images: draft.images, errors: [earlier, failure], pending: 1});
});

test('attachment additions preserve selection order, filenames and duplicate images', () => {
  const existing = [image('one')];
  const additions = [image('two'), image('three')];
  expect(fitPromptImages(existing, additions)).toEqual({images: [...existing, ...additions], errors: []});
  expect(existing.length).toBe(1);
});

test('message budget includes existing images, accepts its exact boundary and rejects only excess additions', () => {
  const existing = [image('one', 'a'.repeat(24 * 1024 * 1024 - 8))];
  const fit = fitPromptImages(existing, [image('two'), image('three')]);
  expect(fit.images.map(item => item.id)).toEqual(['one', 'two']);
  expect(fit.errors).toEqual([{id: 'three', name: 'three.png', reason: 'message image limit reached'}]);
});

test('an oversized image does not prevent later smaller selections from fitting', () => {
  const fit = fitPromptImages([], [image('large', 'a'.repeat(24 * 1024 * 1024 + 1)), image('small')]);
  expect(fit.images.map(item => item.id)).toEqual(['small']);
  expect(fit.errors[0].name).toBe('large.png');
});

test('image-only and mixed optimistic messages use the canonical Pi block order', () => {
  const images = [image('one').content, image('two').content];
  expect(promptContent('', images)).toEqual(images);
  expect(promptContent('Look at these.', images)).toEqual([{type: 'text', text: 'Look at these.'}, ...images]);
  expect(promptContent('Text only.', [])).toEqual([{type: 'text', text: 'Text only.'}]);
});

test('canonical host image echo reconciles with the optimistic attachment message', () => {
  const images = [image('one').content];
  const messages = [{role: 'user', content: promptContent('', images)}];
  expect(reconcileUserMessage(messages, {role: 'user', content: images})).toBe(messages);
});
