type TableNode = {
  type: string;
  content: string;
  attributes: Record<string, unknown>;
  children: TableNode[];
};

function cellText(node: TableNode): string {
  if (node.children.length) return node.children.map(cellText).join('');
  if (node.type === 'image') return String(node.attributes.alt ?? '');
  return node.content;
}

export function tableColumnWidths(table: TableNode): number[] {
  const widths: number[] = [];
  for (const section of table.children) {
    const rows = section.type === 'tr' ? [section] : section.children.filter(child => child.type === 'tr');
    for (const row of rows) {
      const cells = row.children.filter(child => child.type === 'th' || child.type === 'td');
      cells.forEach((cell, index) => {
        const length = Math.max(...cellText(cell).split(/\r?\n/).map(line => [...line].length));
        const width = Math.min(320, Math.max(80, Math.ceil(length * 7 + 24)));
        widths[index] = Math.max(widths[index] ?? 0, width);
      });
    }
  }
  return widths;
}
