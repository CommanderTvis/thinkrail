import {expect, test} from 'bun:test';
import {foldLoginFrame} from './providerLoginState.ts';

test('host login frames retain URL while waiting for a pasted secret', () => {
  const initial = {loginId: 'l1', providerId: 'p1', status: 'active'};
  const url = foldLoginFrame(initial, {kind: 'authUrl', url: 'https://example.com/login'});
  const prompt = foldLoginFrame(url, {kind: 'prompt', message: 'Paste code', secret: true});
  expect(prompt.url).toBe('https://example.com/login');
  expect(prompt.input).toMatchObject({kind: 'prompt', secret: true});
  expect(foldLoginFrame(prompt, {kind: 'success'})).toMatchObject({status: 'success', input: undefined});
});

test('a device-code choice can be replaced by progress and an error', () => {
  const initial = {loginId: 'l2', providerId: 'p2', status: 'active'};
  const code = foldLoginFrame(initial, {kind: 'deviceCode', userCode: 'ABCD', verificationUri: 'https://example.com'});
  const choice = foldLoginFrame(code, {kind: 'select', message: 'Pick plan', options: [{id: 'pro', label: 'Pro'}]});
  const progress = foldLoginFrame(choice, {kind: 'progress', message: 'Checking'});
  expect(progress.deviceCode?.userCode).toBe('ABCD');
  expect(progress.progress).toBe('Checking');
  expect(foldLoginFrame(progress, {kind: 'error', message: 'Expired'})).toMatchObject({status: 'error', error: 'Expired'});
});
