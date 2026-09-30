import {expect, test} from 'bun:test';
import {buildChangeTree} from './changeTree.ts';

test('tree groups changed files by directory and carries diff counts', () => {
  const tree = buildChangeTree([
    {path: 'src/chat/view.tsx', status: 'modified', added: 3, removed: 1},
    {path: 'README.md', status: 'modified', added: 1, removed: 0},
    {path: 'src/chat/store.ts', status: 'added', added: 2, removed: 0},
  ]);
  expect(tree.map(node => node.name)).toEqual(['src', 'README.md']);
  expect(tree[0]).toMatchObject({kind: 'dir', added: 5, removed: 1, children: [
    {kind: 'dir', name: 'chat', added: 5, removed: 1, children: [
      {kind: 'file', name: 'store.ts', path: 'src/chat/store.ts'},
      {kind: 'file', name: 'view.tsx', path: 'src/chat/view.tsx'},
    ]},
  ]});
});
