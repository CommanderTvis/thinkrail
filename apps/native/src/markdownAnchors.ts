import type {View} from 'react-native';

export type MarkdownAnchors = {root: View | null; headings: Map<string, View>};

export function scrollToMarkdownHeading(layout: MarkdownAnchors, href: string, scroll: (y: number) => void) {
  let id: string;
  try {id = decodeURIComponent(href.slice(1));} catch {return;}
  const root = layout.root;
  const heading = layout.headings.get(id);
  if (!root || !heading) return;
  heading.measureLayout(root, (_x, y) => {
    if (layout.root === root && layout.headings.get(id) === heading) scroll(y);
  }, () => {});
}
