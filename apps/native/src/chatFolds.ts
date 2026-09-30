import {useState} from 'react';

const choices = new Map<string, boolean>();

export function useChatFold(id: string, fallback = false): [boolean, () => void] {
  const [override, setOverride] = useState(() => choices.get(id));
  const expanded = override ?? fallback;
  return [expanded, () => {choices.set(id, !expanded); setOverride(!expanded);}];
}
