export function tid(id: string, attrs: Record<string, string | number | boolean | undefined> = {}) {
  const pairs = Object.entries(attrs).filter(([, value]) => value !== undefined).map(([key, value]) => `|${key}=${value}`);
  return {testID: id + pairs.join("")};
}
