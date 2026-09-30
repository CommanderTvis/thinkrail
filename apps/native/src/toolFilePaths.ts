function absolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path);
}

function canonical(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\/+/, '');
  const drive = /^[A-Za-z]:\//.exec(normalized)?.[0];
  const rooted = absolute(normalized);
  const body = drive ? normalized.slice(drive.length) : normalized.replace(/^\/+/, '');
  const segments: string[] = [];
  for (const segment of body.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      const previous = segments.at(-1);
      if (previous && previous !== '..') segments.pop();
      else if (!rooted) segments.push(segment);
    } else segments.push(segment);
  }
  return `${drive ?? (rooted ? '/' : '')}${segments.join('/')}`;
}

export function toolFileReference(path: string, root: string): {label: string; target: string | null} {
  const candidate = path.trim();
  if (!candidate || candidate.includes('\0')) return {label: candidate, target: null};
  const normalized = canonical(candidate);
  if (!absolute(normalized) && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate)) return {label: candidate, target: null};
  const canonicalRoot = canonical(root);
  const base = canonicalRoot === '/' || /^[A-Za-z]:\/$/.test(canonicalRoot) ? canonicalRoot : canonicalRoot.replace(/\/+$/, '');
  const ignoreCase = /^[A-Za-z]:\//.test(normalized) && /^[A-Za-z]:\//.test(base);
  const comparable = ignoreCase ? normalized.toLowerCase() : normalized;
  const comparableBase = ignoreCase ? base.toLowerCase() : base;
  const prefix = comparableBase.endsWith('/') ? comparableBase : `${comparableBase}/`;
  const label = absolute(normalized) && base && (comparable === comparableBase || comparable.startsWith(prefix))
    ? normalized.slice(base.length).replace(/^\/+/, '') || normalized.split('/').filter(Boolean).at(-1) || normalized
    : normalized;
  return {label, target: !label || absolute(label) || label === '..' || label.startsWith('../') ? null : label};
}

export function toolFileLinkEnabled(name: string, status: 'running' | 'done' | 'error'): boolean {
  return name === 'read' ? status !== 'running' : status === 'done';
}

export function toolFileLanguage(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
  const languages: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
    json: 'json', py: 'python', sh: 'bash', bash: 'bash', zsh: 'bash', css: 'css', html: 'html',
    md: 'markdown', yml: 'yaml', yaml: 'yaml',
  };
  return languages[extension] ?? '';
}

export function readRange(args: Record<string, unknown>): string {
  const offset = typeof args.offset === 'number' ? args.offset : undefined;
  const limit = typeof args.limit === 'number' ? args.limit : undefined;
  if (offset != null && offset > 1) return limit != null ? `lines ${offset}–${offset + limit - 1}` : `from line ${offset}`;
  return limit != null ? `first ${limit} lines` : '';
}

export function editLines(args: Record<string, unknown>): {old: string[]; next: string[]} {
  const value = (keys: string[]) => keys.map(key => args[key]).find(text => typeof text === 'string' && text.length > 0);
  const old = value(['oldText', 'old_string', 'old']);
  const next = value(['newText', 'new_string', 'new']);
  return {old: typeof old === 'string' ? old.split('\n') : [], next: typeof next === 'string' ? next.split('\n') : []};
}

export function countToolLines(text: string): number {
  if (!text) return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}
