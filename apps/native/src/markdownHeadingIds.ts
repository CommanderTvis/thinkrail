import type {MarkdownIt} from 'react-native-markdown-display';

type Token = {type: string; content: string; children?: Token[]; attrSet: (name: string, value: string) => void};

export function slugifyHeading(text: string) {
  return text.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}

export function enableHeadingIds(markdown: MarkdownIt) {
  markdown.core.ruler.after('inline', 'thinkrail-heading-ids', (state: {tokens: Token[]}) => {
    const seen = new Map<string, number>();
    for (let index = 0; index < state.tokens.length - 1; index++) {
      const heading = state.tokens[index];
      const inline = state.tokens[index + 1];
      if (heading.type !== 'heading_open' || inline.type !== 'inline') continue;
      const base = slugifyHeading(inline.children?.map(child => child.type === 'image' ? ''
        : child.type === 'softbreak' ? '\n' : child.content).join('') ?? inline.content);
      if (!base) continue;
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      heading.attrSet('id', count ? `${base}-${count}` : base);
    }
  });
}
