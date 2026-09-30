export function syntaxColor(value: string | undefined, syntax: Record<string, string>): string {
  const variable = /^var\(--code-([a-z-]+)\)$/.exec(value ?? '')?.[1];
  const key = variable?.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return key ? syntax[key] ?? syntax.foreground : value ?? syntax.foreground;
}
