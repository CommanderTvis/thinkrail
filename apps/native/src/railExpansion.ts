import {useSyncExternalStore} from 'react';
import {Settings} from 'react-native-macos';

let key = '';
let collapsed: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};};
const snapshot = () => collapsed;

function publish(next: ReadonlySet<string>) {
  collapsed = next;
  for (const listener of listeners) listener();
}

export function initRailExpansion(hostURL: string) {
  key = `thinkrail.rail-collapsed:${hostURL}`;
  const stored = Settings.get(key);
  publish(new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []));
}

export function setProjectExpanded(projectId: string, expanded: boolean) {
  const next = new Set(collapsed);
  if (expanded) next.delete(projectId); else next.add(projectId);
  if (key) Settings.set({[key]: [...next]});
  publish(next);
}

export const useCollapsedProjects = () => useSyncExternalStore(subscribe, snapshot);
