import type {Change} from './HostClient';

export type ChangeNode = {kind: 'file'; name: string; path: string; change: Change; added: number; removed: number}
  | {kind: 'dir'; name: string; path: string; children: ChangeNode[]; added: number; removed: number};

type Builder = {dirs: Map<string, Builder>; files: ChangeNode[]};

export function buildChangeTree(changes: readonly Change[]): ChangeNode[] {
  const root: Builder = {dirs: new Map(), files: []};
  for (const change of changes) {
    const parts = change.path.split('/');
    const name = parts.pop() ?? change.path;
    let parent = root;
    for (const part of parts) {
      let child = parent.dirs.get(part);
      if (!child) {
        child = {dirs: new Map(), files: []};
        parent.dirs.set(part, child);
      }
      parent = child;
    }
    parent.files.push({kind: 'file', name, path: change.path, change, added: change.added ?? 0, removed: change.removed ?? 0});
  }
  const materialize = (builder: Builder, prefix: string): ChangeNode[] => {
    const dirs: ChangeNode[] = [...builder.dirs].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => {
      const path = prefix ? `${prefix}/${name}` : name;
      const children = materialize(child, path);
      return {kind: 'dir', name, path, children,
        added: children.reduce((sum, node) => sum + node.added, 0),
        removed: children.reduce((sum, node) => sum + node.removed, 0)};
    });
    return [...dirs, ...builder.files.sort((a, b) => a.name.localeCompare(b.name))];
  };
  return materialize(root, '');
}
