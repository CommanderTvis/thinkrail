import type {DiffScope} from './HostClient';

export type CenterTab =
  | {id: string; kind: 'chat'; sessionId: string}
  | {id: string; kind: 'terminal'; tabKey: string}
  | {id: string; kind: 'editor'; path: string}
  | {id: string; kind: 'diff'; path: string; scope: DiffScope};

export type CenterTabs = {tabs: CenterTab[]; activeId: string};

export const emptyCenterTabs = (): CenterTabs => ({tabs: [], activeId: ''});

export function openCenterTab(state: CenterTabs, tab: CenterTab): CenterTabs {
  return {tabs: state.tabs.some(item => item.id === tab.id) ? state.tabs : [...state.tabs, tab], activeId: tab.id};
}

export function selectCenterTab(state: CenterTabs, id: string): CenterTabs {
  return state.tabs.some(tab => tab.id === id) ? {...state, activeId: id} : state;
}

export function closeCenterTab(state: CenterTabs, id: string): CenterTabs {
  const index = state.tabs.findIndex(tab => tab.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter(tab => tab.id !== id);
  const activeId = state.activeId === id ? tabs[Math.min(index, tabs.length - 1)]?.id ?? '' : state.activeId;
  return {tabs, activeId};
}
