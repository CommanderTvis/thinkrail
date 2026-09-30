export function classifyHref(href: string): 'anchor' | 'external' | 'relative' {
  if (href.startsWith('#')) return 'anchor';
  if (href.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(href)) return 'external';
  return 'relative';
}

export function resolveRelativePath(fromFile: string, href: string): string | null {
  const pathname = href.split(/[?#]/, 1)[0];
  let decoded: string;
  try {decoded = decodeURIComponent(pathname).replaceAll('\\', '/');}
  catch {return null;}
  if (!decoded || decoded.includes('\0')) return null;
  const directory = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
  const segments = decoded.startsWith('/') || !directory ? [] : directory.split('/');
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join('/') || null;
}
