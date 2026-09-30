export function stripFrontmatter(text: string) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---')) return normalized;
  const end = normalized.indexOf('\n---', 3);
  return end === -1 ? normalized : normalized.slice(end + 4).trim();
}
