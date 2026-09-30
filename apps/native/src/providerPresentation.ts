import type {ProviderStatus} from './HostClient';

const authLabels: Record<string, string> = {oauth: 'OAuth subscription', 'api-key': 'API key', env: 'environment', central: 'JetBrains AI', other: 'configured'};
export const providerAuthLabel = (kind?: string) => kind ? authLabels[kind] ?? 'configured' : 'configured';

export function providerGroups(providers: ProviderStatus[], expanded: boolean) {
  const connected = providers.filter(provider => provider.configured);
  const unconfigured = providers.filter(provider => !provider.configured);
  const subscriptions = unconfigured.filter(provider => provider.canOAuth);
  const keys = unconfigured.filter(provider => provider.canApiKey && !provider.canOAuth);
  const shownKeys = expanded ? keys : keys.slice(0, 6);
  const external = unconfigured.filter(provider => !provider.canOAuth && !provider.canApiKey);
  const externalSummary = external.length ? `${external.length} more are configured outside the app (environment variables or models.json): ${external.slice(0, 5).map(provider => provider.name).join(', ')}${external.length > 5 ? ', …' : ''}` : '';
  return {connected, subscriptions, shownKeys, hiddenKeys: keys.length - shownKeys.length, externalSummary};
}
