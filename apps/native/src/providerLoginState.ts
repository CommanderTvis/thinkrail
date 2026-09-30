export type LoginFrame =
  | {kind: 'authUrl'; url: string; instructions?: string}
  | {kind: 'deviceCode'; userCode: string; verificationUri: string}
  | {kind: 'select'; message: string; options: {id: string; label: string}[]}
  | {kind: 'prompt'; message: string; placeholder?: string; allowEmpty?: boolean; secret?: boolean}
  | {kind: 'progress'; message: string}
  | {kind: 'success'}
  | {kind: 'error'; message: string};

export type LoginState = {
  loginId: string; providerId: string; status: 'active' | 'success' | 'error';
  url?: string; instructions?: string; deviceCode?: {userCode: string; verificationUri: string};
  input?: Extract<LoginFrame, {kind: 'select' | 'prompt'}>; progress?: string; error?: string;
};

export type LoginPush = {loginId: string; providerId: string; frame: LoginFrame};

export function foldLoginFrame(state: LoginState, frame: LoginFrame): LoginState {
  switch (frame.kind) {
    case 'authUrl': return {...state, url: frame.url, instructions: frame.instructions};
    case 'deviceCode': return {...state, deviceCode: {userCode: frame.userCode, verificationUri: frame.verificationUri}};
    case 'select': return {...state, input: frame, progress: undefined};
    case 'prompt': return {...state, input: frame, progress: undefined};
    case 'progress': return {...state, progress: frame.message};
    case 'success': return {...state, status: 'success', input: undefined, progress: undefined};
    case 'error': return {...state, status: 'error', error: frame.message, input: undefined, progress: undefined};
  }
}
