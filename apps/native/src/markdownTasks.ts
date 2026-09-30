type TaskToken = {
  type: string;
  content: string;
  children?: TaskToken[] | null;
  attrSet: (name: string, value: string) => void;
};

type TaskMarkdown = {
  core: {ruler: {after: (rule: string, name: string, transform: (state: {tokens: TaskToken[]}) => void) => void}};
};

const marker = /^\[([ xX])\](?:[ \t]+|$)/;

export function enableTaskLists(md: TaskMarkdown) {
  md.core.ruler.after('inline', 'task_lists', state => {
    const items: TaskToken[] = [];
    const visited = new Set<TaskToken>();
    for (const token of state.tokens) {
      if (token.type === 'list_item_open') {
        items.push(token);
      } else if (token.type === 'list_item_close') {
        items.pop();
      } else if (token.type === 'inline') {
        const item = items.at(-1);
        if (!item || visited.has(item)) continue;
        visited.add(item);
        const first = token.children?.[0];
        const match = first?.type === 'text' ? marker.exec(first.content) : null;
        if (!first || !match) continue;
        item.attrSet('taskChecked', match[1] === ' ' ? 'false' : 'true');
        first.content = first.content.slice(match[0].length);
        token.content = token.content.slice(match[0].length);
      }
    }
  });
}
