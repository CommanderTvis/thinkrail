import {expect, test} from 'bun:test';
import {providerAuthLabel, providerGroups} from './providerPresentation';

test('provider capabilities form disjoint connected, subscription and key groups in host order', () => {
  const connected = {id: 'connected', name: 'Connected', configured: true, canOAuth: true, canApiKey: true};
  const subscription = {id: 'subscription', name: 'Subscription', configured: false, canOAuth: true, canApiKey: true};
  const keys = Array.from({length: 8}, (_, i) => ({id: `key-${i}`, name: `Key ${i}`, configured: false, canApiKey: true}));
  const providers = [connected, subscription, ...keys];
  const collapsed = providerGroups(providers, false);
  expect(collapsed.connected).toEqual([connected]);
  expect(collapsed.subscriptions).toEqual([subscription]);
  expect(collapsed.shownKeys).toEqual(keys.slice(0, 6));
  expect(collapsed.hiddenKeys).toBe(2);
  expect(providerGroups(providers, true).shownKeys).toEqual(keys);
  expect(providerGroups(providers, true).hiddenKeys).toBe(0);
  expect(providers).toEqual([connected, subscription, ...keys]);
});

test('external provider summary counts every provider but caps the displayed names at five', () => {
  const external = Array.from({length: 6}, (_, i) => ({id: `external-${i}`, name: `External ${i}`, configured: false}));
  expect(providerGroups(external, false).externalSummary).toBe('6 more are configured outside the app (environment variables or models.json): External 0, External 1, External 2, External 3, External 4, …');
  expect(providerGroups(external.slice(0, 1), false).externalSummary).toBe('1 more are configured outside the app (environment variables or models.json): External 0');
  expect(providerGroups([], false).externalSummary).toBe('');
});

test('connected authentication categories retain the original user-facing labels', () => {
  expect(['oauth', 'api-key', 'env', 'central', 'other', undefined].map(providerAuthLabel)).toEqual(['OAuth subscription', 'API key', 'environment', 'JetBrains AI', 'configured', 'configured']);
});
