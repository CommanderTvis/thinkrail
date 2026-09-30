import type {SkillCatalogEntry} from './HostClient';

const tiers: Record<string, {label: string; hint: string; rank: number}> = {
  bundled: {label: 'ThinkRail', hint: 'Bundled with the app.', rank: 0},
  pi: {label: 'Pi', hint: 'Pi-native / configured.', rank: 1},
  personal: {label: 'Personal', hint: 'Your own libraries (~/.claude, ~/.codex, …).', rank: 2},
  project: {label: 'Project', hint: 'Committed to the repo — gated behind trust.', rank: 4},
};

export type SkillGroup = {key: string; label: string; hint: string; isPlugin: boolean; leading: boolean; items: SkillCatalogEntry[]};

export function skillGroups(entries: SkillCatalogEntry[]): SkillGroup[] {
  const byKey = new Map<string, {isPlugin: boolean; items: SkillCatalogEntry[]}>();
  for (const entry of entries) {
    const group = byKey.get(entry.group) ?? {isPlugin: Boolean(entry.plugin), items: []};
    group.items.push(entry);
    byKey.set(entry.group, group);
  }
  return [...byKey.entries()].map(([key, group]) => {
    const tier = tiers[key];
    return {
      key, label: tier?.label ?? key, hint: group.isPlugin ? 'Claude plugin' : tier?.hint ?? '', isPlugin: group.isPlugin,
      leading: key === 'bundled' || key === 'pi', items: group.items, rank: group.isPlugin ? 3 : tier?.rank ?? 5,
    };
  }).sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label)).map(({rank: _rank, ...group}) => group);
}

export function skillSwitchHint(checked: boolean, busy: boolean, blockedReason?: string) {
  return busy ? 'Saving skill settings…' : blockedReason ?? `${checked ? 'On' : 'Off'} — turn ${checked ? 'off' : 'on'}`;
}
