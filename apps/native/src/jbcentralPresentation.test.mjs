import {expect, test} from 'bun:test';
import {centralActions, centralFailureText, centralSignedOut, centralStatusBody} from './jbcentralPresentation';

const configured = {state: 'configured', version: '1', signedOut: false, proxyStopped: false};

test('Central authentication takes precedence over connection and proxy actions', () => {
  expect(centralActions({state: 'supported', version: '1', signedOut: true})).toEqual(['sign-in']);
  expect(centralActions({...configured, signedOut: true, proxyStopped: true})).toEqual(['sign-in']);
  expect(centralStatusBody({...configured, signedOut: true}).tone).toBe('warning');
  expect(centralSignedOut({state: 'absent'})).toBe(false);
});

test('Central offers the correct actions for version, connection and failed runtime states', () => {
  expect(centralActions({state: 'supported', version: '1', signedOut: false})).toEqual(['connect']);
  expect(centralActions(configured)).toEqual(['disconnect']);
  expect(centralActions({...configured, proxyStopped: true})).toEqual(['start-proxy']);
  expect(centralActions({state: 'outdated', version: '0'})).toEqual(['update']);
  expect(centralActions({state: 'load-failed', configured: true, reason: 'candidate-failed'})).toEqual(['retry', 'disconnect']);
  expect(centralActions({state: 'load-failed', configured: false, reason: 'candidate-failed'})).toEqual(['retry']);
  expect(centralActions({state: 'configuring', action: 'connect'})).toEqual([]);
});

test('every host status has guidance and only healthy configured Central reports success', () => {
  const statuses = [{state: 'absent'}, {state: 'outdated', version: '0'}, {state: 'supported', version: '1', signedOut: false}, configured,
    {...configured, proxyStopped: true}, {state: 'malformed-version'}, {state: 'probe-failed', reason: 'timed-out'},
    {state: 'configuring', action: 'start-proxy'}, {state: 'load-failed', configured: true, reason: 'candidate-failed'}];
  for (const status of statuses) expect(centralStatusBody(status).text.length).toBeGreaterThan(20);
  expect(statuses.filter(status => centralStatusBody(status).tone === 'success')).toEqual([configured]);
  expect(centralStatusBody({state: 'configuring', action: 'start-proxy'})).toMatchObject({icon: 'loader', text: 'Central is starting the proxy. Keep ThinkRail open.'});
  expect(centralActions({state: 'probe-failed', reason: 'timed-out'})).toEqual(['recheck']);
  expect(centralActions({state: 'malformed-version'})).toEqual(['recheck']);
});

test('failed Central actions explain retained runtime and offer host-specific recovery', () => {
  expect(centralFailureText('connect', 'candidate-failed')).toContain('previous runtime was retained');
  expect(centralFailureText('start-proxy', 'central-action-failed')).toContain("couldn't start the proxy");
  expect(centralFailureText('connect', 'artifact-missing')).toBe(centralFailureText('disconnect', 'artifact-present'));
  expect(centralFailureText('update', 'not-installed')).toContain('Install it and Recheck');
});
