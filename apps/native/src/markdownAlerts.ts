import type {MarkdownIt} from 'react-native-markdown-display';

export type AlertVariant = 'note' | 'tip' | 'important' | 'warning' | 'caution';
const marker = /^\[!(note|tip|important|warning|caution)\]/i;
type Token = {type: string; content: string; children?: Token[]; attrSet: (name: string, value: string) => void};
type State = {tokens: Token[]};

export function enableGithubAlerts(markdown: MarkdownIt) {
  markdown.core.ruler.after('inline', 'thinkrail-alerts', (state: State) => {
    const tokens = state.tokens;
    for (let index = 0; index < tokens.length - 2; index++) {
      if (tokens[index].type !== 'blockquote_open' || tokens[index + 1].type !== 'paragraph_open') continue;
      const inline = tokens[index + 2];
      if (inline.type !== 'inline' || !inline.children?.length) continue;
      const first = inline.children[0];
      if (first.type !== 'text') continue;
      const match = marker.exec(first.content);
      if (!match) continue;
      tokens[index].attrSet('alert', match[1].toLowerCase());
      first.content = first.content.slice(match[0].length).trimStart();
      if (!first.content) inline.children.shift();
      if (inline.children[0]?.type === 'softbreak') inline.children.shift();
      if (!inline.children.length && tokens[index + 3]?.type === 'paragraph_close') tokens.splice(index + 1, 3);
    }
  });
}
