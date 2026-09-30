import type {JbcentralAction, JbcentralActionFailureReason, JbcentralStatus} from '../../../packages/contracts/src';

export const centralActionLabel = (action: JbcentralAction) => ({connect: 'Connect', disconnect: 'Disconnect', 'start-proxy': 'Start proxy', update: 'Update'})[action];
export const centralSignedOut = (status: JbcentralStatus) => (status.state === 'supported' || status.state === 'configured') && status.signedOut;

export function centralActions(status: JbcentralStatus): (JbcentralAction | 'sign-in' | 'retry' | 'recheck')[] {
  if (centralSignedOut(status)) return ['sign-in'];
  switch (status.state) {
    case 'supported': return ['connect'];
    case 'configured': return [status.proxyStopped ? 'start-proxy' : 'disconnect'];
    case 'outdated': return ['update'];
    case 'load-failed': return status.configured ? ['retry', 'disconnect'] : ['retry'];
    case 'malformed-version': case 'probe-failed': return ['recheck'];
    default: return [];
  }
}

export function centralStatusBody(status: JbcentralStatus): {text: string; tone: 'muted' | 'warning' | 'success' | 'red'; icon?: 'check' | 'alertWarning' | 'loader'} {
  if (centralSignedOut(status)) return {text: 'Central is signed out. Sign in to use its JetBrains AI models.', tone: 'warning', icon: 'alertWarning'};
  switch (status.state) {
    case 'absent': return {text: 'Install the JetBrains Central CLI (central), then Recheck:', tone: 'muted'};
    case 'outdated': return {text: `Central ${status.version} is older than the minimum ThinkRail supports. Update it before connecting.`, tone: 'warning'};
    case 'supported': return {text: 'Central is ready. Connect to make its JetBrains AI models available to new chats.', tone: 'muted'};
    case 'configured': return status.proxyStopped
      ? {text: "Central's proxy is not running. Start it to use JetBrains AI models.", tone: 'warning', icon: 'alertWarning'}
      : {text: "Connected — Central's JetBrains AI models are available to new chats.", tone: 'success', icon: 'check'};
    case 'malformed-version': return {text: "ThinkRail couldn't verify this Central version safely. Reinstall Central, then Recheck.", tone: 'red'};
    case 'probe-failed': return {text: "ThinkRail couldn't verify Central right now. Check the host installation, then Recheck.", tone: 'red'};
    case 'configuring': {
      const progress = status.action && {connect: 'connecting', disconnect: 'disconnecting', 'start-proxy': 'starting the proxy', update: 'updating'}[status.action];
      return {text: progress ? `Central is ${progress}. Keep ThinkRail open.` : 'ThinkRail is applying the latest Central configuration.', tone: 'muted', icon: 'loader'};
    }
    case 'load-failed': return {text: "ThinkRail couldn't prepare the updated model runtime. The previous runtime remains available; retry, or disconnect Central to rebuild without it.", tone: 'red', icon: 'alertWarning'};
  }
}

export function centralFailureText(action: JbcentralAction, reason: JbcentralActionFailureReason): string {
  switch (reason) {
    case 'not-installed': return "Central isn't available on the host yet. Install it and Recheck.";
    case 'unsupported-version': return 'This Central version isn\'t supported by ThinkRail. Follow the version guidance and retry.';
    case 'version-probe-failed': return "ThinkRail couldn't verify Central safely. Check the host installation and Recheck.";
    case 'central-action-failed': return action === 'start-proxy' ? "Central couldn't start the proxy. Check Central on the host and try again." : `Central couldn't ${action}. Check Central on the host and try again.`;
    case 'artifact-missing': case 'artifact-present': return "Central finished, but ThinkRail couldn't confirm the configuration. Recheck and retry.";
    case 'candidate-failed': return "ThinkRail couldn't prepare the updated model runtime. The previous runtime was retained.";
  }
}
