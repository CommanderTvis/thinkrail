import {expect, test} from 'bun:test';
import {countToolLines, editLines, readRange, toolFileLanguage, toolFileLinkEnabled, toolFileReference} from './toolFilePaths.ts';
import {languageFromPath} from '../../../apps/web/src/chat/tools/toolHelpers.ts';

test('read/write syntax languages match original file-extension choices', () => {
  for (const extension of ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'py', 'sh', 'bash', 'zsh', 'css', 'html', 'md', 'yml', 'yaml', 'txt', 'unknown']) {
    const path = `/repo/src/file.${extension.toUpperCase()}`;
    expect(toolFileLanguage(path)).toBe(languageFromPath(path));
  }
  expect(toolFileLanguage('Makefile')).toBe('');
  expect(toolFileLanguage('')).toBe('');
});

test('relative and in-workspace absolute references share canonical file-tab targets', () => {
  expect(toolFileReference(' module-a/../README.md ', '/repo')).toEqual({label: 'README.md', target: 'README.md'});
  expect(toolFileReference('/repo/module-a/SPEC.md', '/repo/')).toEqual({label: 'module-a/SPEC.md', target: 'module-a/SPEC.md'});
  expect(toolFileReference('/repo/../outside.md', '/repo')).toEqual({label: '/outside.md', target: null});
  expect(toolFileReference('c:\\repo\\src\\a.ts', 'C:\\REPO')).toEqual({label: 'src/a.ts', target: 'src/a.ts'});
  expect(toolFileReference('c:/src/a.ts', 'C:/')).toEqual({label: 'src/a.ts', target: 'src/a.ts'});
});

test('foreign, escaping, URI, and empty references remain inert', () => {
  for (const path of ['/tmp/outside.png', '/repository/a.ts', '../outside.md', 'a/../../outside.md', 'https://example.com/a.md', 'file:///repo/a.md', '', 'a\0b']) {
    expect(toolFileReference(path, '/repo').target).toBeNull();
  }
  expect(toolFileReference('https://example.com/a.md', '/repo').label).toBe('https://example.com/a.md');
});

test('read links become available after reading, mutation links only after success', () => {
  for (const name of ['read', 'write', 'edit']) {
    expect(toolFileLinkEnabled(name, 'running')).toBe(false);
    expect(toolFileLinkEnabled(name, 'done')).toBe(true);
    expect(toolFileLinkEnabled(name, 'error')).toBe(name === 'read');
  }
});

test('read ranges and edit argument variants match the original renderers', () => {
  expect(readRange({offset: 10, limit: 5})).toBe('lines 10–14');
  expect(readRange({offset: 10})).toBe('from line 10');
  expect(readRange({limit: 5})).toBe('first 5 lines');
  expect(readRange({offset: '10'})).toBe('');
  expect(editLines({oldText: 'a\nb', newText: 'c'})).toEqual({old: ['a', 'b'], next: ['c']});
  expect(editLines({oldText: '', old_string: 'old', new: 'new\n'})).toEqual({old: ['old'], next: ['new', '']});
  expect(editLines({})).toEqual({old: [], next: []});
});

test('long-content line count ignores a final newline but retains empty internal lines', () => {
  expect(countToolLines('')).toBe(0);
  expect(countToolLines('a\n')).toBe(1);
  expect(countToolLines('a\n\nb')).toBe(3);
  expect(countToolLines('line\n'.repeat(24))).toBe(24);
  expect(countToolLines('line\n'.repeat(25))).toBe(25);
});
