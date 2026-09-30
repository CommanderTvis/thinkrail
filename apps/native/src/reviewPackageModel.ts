export type ReviewPackageItem = {path: string | null; lineRef: string; fragment: string | null; body: string};
export type ReviewPackage = {count: number; files: string[]; items: ReviewPackageItem[]};
export type ReviewFixCardData = {summary: string; note: string; items: ReviewPackageItem[]};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseReviewFix(message: unknown): ReviewFixCardData | null {
  if (!isRecord(message) || message.role !== 'custom' || message.customType !== 'todo-review-fix') return null;
  const details = message.details;
  if (!isRecord(details) || typeof details.itemId !== 'string' || typeof details.itemTitle !== 'string' || !Array.isArray(details.comments)) return null;
  const items: ReviewPackageItem[] = [];
  for (const comment of details.comments) {
    if (!isRecord(comment) || typeof comment.body !== 'string'
      || (comment.path !== undefined && typeof comment.path !== 'string')
      || (comment.startLine !== undefined && typeof comment.startLine !== 'number')
      || (comment.endLine !== undefined && typeof comment.endLine !== 'number')) return null;
    const path = typeof comment.path === 'string' ? comment.path : null;
    const start = comment.startLine;
    const end = comment.endLine;
    const location = start === undefined ? '' : end === undefined || end === start ? `L${start}` : `L${start}–${end}`;
    items.push({path, lineRef: path && location ? `${path} ${location}` : path ?? location, fragment: null, body: comment.body});
  }
  const noun = items.length === 1 ? 'finding' : 'findings';
  const summary = `Requested a fix on “${details.itemTitle}”${items.length ? ` · ${items.length} ${noun}` : ''}`;
  return {summary, note: typeof details.note === 'string' ? details.note : '', items};
}

function lineRefOf(lines: string | undefined): string {
  const match = lines ? /^(\d+)-(\d+)$/.exec(lines) : null;
  if (!match) return '';
  return match[1] === match[2] ? `L${match[1]}` : `L${match[1]}–${match[2]}`;
}

function blockOf(tag: string, block: string): string | null {
  return new RegExp(`^<${tag}[^\\n]*>\\n([\\s\\S]*?)\\n</${tag}>$`, 'm').exec(block)?.[1] ?? null;
}

export function parseReviewPackage(text: string): ReviewPackage | null {
  if (!/^<review id="[^"]+" branch="[^"]*" base="[^"]*" comments="\d+">$/m.test(text)) return null;
  const comments = [...text.matchAll(/^<comment (id="[^"]+" kind="[^"]+"[^\n]*)>$\n([\s\S]*?)^<\/comment>$/gm)];
  if (!comments.length) return null;
  const files: string[] = [];
  const items: ReviewPackageItem[] = [];
  for (const [, attrs = '', block = ''] of comments) {
    const path = /\spath="([^"]+)"/.exec(attrs)?.[1] ?? null;
    if (path && !files.includes(path)) files.push(path);
    items.push({path, lineRef: lineRefOf(/\slines="([^"]+)"/.exec(attrs)?.[1]), fragment: blockOf('fragment', block), body: blockOf('text', block) ?? ''});
  }
  return {count: comments.length, files, items};
}

export function reviewPackageLabel(review: Pick<ReviewPackage, 'count' | 'files'>): string {
  const noun = review.count === 1 ? 'review comment' : 'review comments';
  const where = !review.files.length ? 'the change set' : review.files.length === 1 ? review.files[0] : `${review.files.length} files`;
  return `Sent ${review.count} ${noun} on ${where}`;
}

export function keyReviewItems(items: ReviewPackageItem[]): {key: string; item: ReviewPackageItem}[] {
  const seen = new Map<string, number>();
  return items.map(item => {
    const base = `${item.lineRef}·${item.body}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return {key: `${base}·${occurrence}`, item};
  });
}
