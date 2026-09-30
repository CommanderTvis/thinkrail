import {Settings} from 'react-native-macos';

type Scope = {projectId: string; workspaceId: string};

const key = (hostURL: string) => `thinkrail.active-scope:${hostURL}`;

export function readActiveScope(hostURL: string): Scope {
  const stored = Settings.get(key(hostURL));
  return stored && typeof stored === 'object'
    ? {projectId: String(stored.projectId ?? ''), workspaceId: String(stored.workspaceId ?? '')}
    : {projectId: '', workspaceId: ''};
}

export function writeActiveScope(hostURL: string, scope: Scope) {
  Settings.set({[key(hostURL)]: scope});
}
