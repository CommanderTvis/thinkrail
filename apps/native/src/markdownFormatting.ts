import {stripFrontmatter} from './frontmatter';

export const markdownOptions = {linkify: true, typographer: false};

type ParagraphToken = {type: string; hidden?: boolean; attrSet: (name: string, value: string) => void};
type BlockParent = {type: string; attributes?: Record<string, unknown>};

export function enableParagraphSpacing(md: {
  core: {ruler: {push: (name: string, transform: (state: {tokens: ParagraphToken[]}) => void) => void}};
}) {
  md.core.ruler.push('paragraph_spacing', state => {
    let listDepth = 0;
    for (const token of state.tokens) {
      if (token.type === 'list_item_open') listDepth++;
      if (token.type === 'list_item_close') listDepth--;
      if (token.type === 'paragraph_open' && token.hidden) token.attrSet('tight', 'true');
      if (listDepth && (token.type === 'paragraph_open' || token.type === 'paragraph_close')) {
        token.type = token.type.replace('paragraph_', 'list_paragraph_');
      }
    }
  });
}

export function paragraphMargin(document: boolean, tight: boolean, parents: BlockParent[]): number {
  if (tight) return 0;
  return document ? parents.some(parent => parent.type === 'list_item' || parent.attributes?.alert) ? 4 : 12 : 8;
}

export function listMarker(index: number, parents: BlockParent[]): string {
  const list = parents.find(parent => parent.type === 'bullet_list' || parent.type === 'ordered_list');
  if (list?.type !== 'ordered_list') return '•';
  const start = Number(list.attributes?.start);
  return `${(Number.isFinite(start) ? start : 1) + index}.`;
}

export function inlineCodeSize(document: boolean, parents: BlockParent[]) {
  const parent = parents.find(node => node.type !== 'inline' && node.type !== 'textgroup');
  const small = !document && (parent?.type === 'td' || parent?.type === 'th');
  return {fontSize: small ? 11 : 13, lineHeight: small ? 16.5 : 20};
}

export function markdownContent(text: string, document: boolean) {
  return document ? stripFrontmatter(text) : text;
}

export function collapsedBlockMargins(blocks: {top: number; bottom: number}[], trimFirst: boolean, trimLast: boolean) {
  return blocks.map((block, index) => ({
    marginTop: index === 0 ? trimFirst ? 0 : block.top
      : Math.max(blocks[index - 1].bottom, block.top) - blocks[index - 1].bottom,
    marginBottom: trimLast && index === blocks.length - 1 ? 0 : block.bottom,
  }));
}
