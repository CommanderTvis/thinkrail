import {expect, test} from 'bun:test';

const built = await Bun.build({entrypoints: [new URL('./HostClient.ts', import.meta.url).pathname], target: 'bun', format: 'esm', plugins: [{name: 'native-theme-fixture', setup(build) {
  build.onResolve({filter: /^\.\/Theme$/}, () => ({path: 'Theme', namespace: 'fixture'}));
  build.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: 'export function setThemePreference() {}', loader: 'js'}));
}}]});
if (!built.success) throw new Error(built.logs.map(String).join('\n'));
const {hostClient} = await import(`data:text/javascript;base64,${Buffer.from(await built.outputs[0].text()).toString('base64')}`);

function fixture(check) {
  const saved = {WebSocket: globalThis.WebSocket, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, now: Date.now};
  const sockets = [], timers = new Map();
  let now = 10000, nextTimer = 0;
  class Socket {
    static OPEN = 1;
    constructor() {sockets.push(this);}
    close() {this.onclose?.();}
  }
  globalThis.WebSocket = Socket;
  globalThis.setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, {callback, delay});
    return id;
  };
  globalThis.clearTimeout = id => timers.delete(id);
  Date.now = () => now;
  const client = new hostClient.constructor();
  client.hydrate = async () => {};
  try {
    client.start('http://127.0.0.1:43423');
    check({client, sockets, timers, advance(ms) {now += ms;}, retry() {
      const [id, timer] = [...timers][0];
      timers.delete(id);
      now += timer.delay;
      timer.callback();
    }});
  } finally {
    client.stop();
    globalThis.WebSocket = saved.WebSocket;
    globalThis.setTimeout = saved.setTimeout;
    globalThis.clearTimeout = saved.clearTimeout;
    Date.now = saved.now;
  }
}

test('host binding at 270 ms is reached without a 500 ms startup retry penalty', () => {
  fixture(f => {
    let elapsed = 0;
    while (elapsed < 270) {
      f.sockets.at(-1).close();
      expect([...f.timers.values()][0].delay).toBe(25);
      f.retry();
      elapsed += 25;
    }
    f.sockets.at(-1).onmessage({data: JSON.stringify({channel: 'server.welcome', data: {protocolVersion: 70}})});
    expect(elapsed).toBe(275);
    expect(f.client.getSnapshot().connection).toBe('connected');
    f.sockets.at(-1).close();
    expect([...f.timers.values()][0].delay).toBe(500);
  });
});

test('an unavailable host falls back to normal retries after one second', () => {
  fixture(f => {
    f.advance(1000);
    f.sockets.at(-1).close();
    expect([...f.timers.values()][0].delay).toBe(500);
  });
});

test('stop cancels startup retry and stale socket closures cannot restart it', () => {
  fixture(f => {
    const stale = f.sockets.at(-1);
    stale.close();
    expect(f.timers.size).toBe(1);
    f.client.stop();
    stale.close();
    expect(f.timers.size).toBe(0);
    f.client.start('http://127.0.0.1:43424');
    stale.close();
    expect(f.timers.size).toBe(0);
    f.sockets.at(-1).close();
    expect([...f.timers.values()][0].delay).toBe(25);
  });
});
