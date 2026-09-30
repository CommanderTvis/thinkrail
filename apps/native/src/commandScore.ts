const gap = /[\\/_+.#"@[({&]/;
const gaps = /[\\/_+.#"@[({&]/g;
const space = /[\s-]/;
const spaces = /[\s-]/g;

export function commandScore(value: string, query: string) {
  const lowerValue = value.toLowerCase().replace(spaces, ' ');
  const lowerQuery = query.toLowerCase().replace(spaces, ' ');
  const memo = new Map<string, number>();
  const score = (valueIndex: number, queryIndex: number): number => {
    if (queryIndex === query.length) return valueIndex === value.length ? 1 : 0.99;
    const key = `${valueIndex},${queryIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const character = lowerQuery.charAt(queryIndex);
    let best = 0;
    for (let index = lowerValue.indexOf(character, valueIndex); index >= 0; index = lowerValue.indexOf(character, index + 1)) {
      let match = score(index + 1, queryIndex + 1);
      if (match > best) {
        if (index !== valueIndex) {
          if (gap.test(value.charAt(index - 1))) {
            match *= 0.8;
            const breaks = value.slice(valueIndex, index - 1).match(gaps);
            if (breaks && valueIndex > 0) match *= Math.pow(0.999, breaks.length);
          } else if (space.test(value.charAt(index - 1))) {
            match *= 0.9;
            const breaks = value.slice(valueIndex, index - 1).match(spaces);
            if (breaks && valueIndex > 0) match *= Math.pow(0.999, breaks.length);
          } else {
            match *= 0.17;
            if (valueIndex > 0) match *= Math.pow(0.999, index - valueIndex);
          }
        }
        if (value.charAt(index) !== query.charAt(queryIndex)) match *= 0.9999;
      }
      if ((match < 0.1 && lowerValue.charAt(index - 1) === lowerQuery.charAt(queryIndex + 1)) ||
        (lowerQuery.charAt(queryIndex + 1) === character && lowerValue.charAt(index - 1) !== character)) {
        match = Math.max(match, score(index + 1, queryIndex + 2) * 0.1);
      }
      best = Math.max(best, match);
    }
    memo.set(key, best);
    return best;
  };
  return score(0, 0);
}
