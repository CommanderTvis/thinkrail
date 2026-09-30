import {expect, test} from 'bun:test';
import {formatJbcentralQuota, quotaTransportFailure, startJbcentralQuotaPolling} from './jbcentralQuota';

const available = {state: 'available', remaining: 19.92, total: 20, observedAt: 1000};
const flush = async () => {await Promise.resolve(); await Promise.resolve();};
function fixture() {
  const requests = [], snapshots = [], timers = new Map();
  let errors = 0, nextTimer = 0;
  const polling = startJbcentralQuotaPolling({
    intervalMs: 30000,
    request: force => new Promise((resolve, reject) => requests.push({force, resolve, reject})),
    onSnapshot: snapshot => snapshots.push(snapshot), onError: () => errors++,
    schedule: (callback, delay) => {const id = ++nextTimer; timers.set(id, {callback, delay}); return id;},
    cancel: id => timers.delete(id),
  });
  return {requests, snapshots, timers, polling, errors: () => errors};
}

test('quota polling starts immediately, waits for completion and stops on host-hidden quota', async () => {
  const f = fixture();
  expect(f.requests.map(x => x.force)).toEqual([false]);
  expect(f.timers.size).toBe(0);
  f.requests[0].resolve(available); await flush();
  expect(f.snapshots).toEqual([available]);
  expect(f.timers.size).toBe(1);
  const timer = [...f.timers.values()][0];
  expect(timer.delay).toBe(30000);
  timer.callback();
  expect(f.timers.size).toBe(0);
  expect(f.requests.map(x => x.force)).toEqual([false, false]);
  f.requests[1].resolve({state: 'hidden'}); await flush();
  expect(f.timers.size).toBe(0);
  f.polling.stop();
});

test('repeated retries during a pending read coalesce into one forced request', async () => {
  const f = fixture();
  f.polling.retry(); f.polling.retry();
  expect(f.requests.length).toBe(1);
  f.requests[0].resolve(available); await flush();
  expect(f.requests.map(x => x.force)).toEqual([false, true]);
  expect(f.timers.size).toBe(0);
  f.requests[1].resolve(available); await flush();
  expect(f.timers.size).toBe(1);
  f.polling.retry();
  expect(f.timers.size).toBe(0);
  expect(f.requests.map(x => x.force)).toEqual([false, true, true]);
  f.polling.stop();
  f.requests[2].resolve(available); await flush();
  expect(f.snapshots.length).toBe(2);
  expect(f.timers.size).toBe(0);
});

test('failed reads keep polling, and stop rejects late errors and queued retries', async () => {
  const f = fixture();
  f.requests[0].reject(new Error('offline')); await flush();
  expect(f.errors()).toBe(1);
  expect(f.timers.size).toBe(1);
  f.polling.retry(); f.polling.retry(); f.polling.stop();
  f.requests[1].reject(new Error('late')); await flush();
  f.polling.retry();
  expect(f.errors()).toBe(1);
  expect(f.requests.length).toBe(2);
  expect(f.timers.size).toBe(0);
});

test('transport failure preserves successful credits and freshness without inventing initial data', () => {
  expect(quotaTransportFailure(available)).toEqual({...available, state: 'stale'});
  expect(quotaTransportFailure({...available, state: 'stale'})).toEqual({...available, state: 'stale'});
  for (const state of ['hidden', 'loading', 'unavailable']) expect(quotaTransportFailure({state})).toEqual({state: 'unavailable'});
});

test('quota values follow locale grouping and rounding, including zero credits', () => {
  expect(formatJbcentralQuota(19.92, 20, 'en-US')).toBe('19.92 / 20');
  expect(formatJbcentralQuota(5000.1, 6000, 'en-US')).toBe('5,000.1 / 6,000');
  expect(formatJbcentralQuota(1.234, 20.999, 'en-US')).toBe('1.23 / 21');
  expect(formatJbcentralQuota(19.92, 20, 'de-DE')).toBe('19,92 / 20');
  expect(formatJbcentralQuota(0, 20, 'en-US')).toBe('0 / 20');
});
