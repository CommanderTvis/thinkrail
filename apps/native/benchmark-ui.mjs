import {spawn, execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => {
  if (index % 2 === 0) pairs.push([value, args[index + 1]]);
  return pairs;
}, []));
const desktop = resolve(options['--desktop'] ?? '');
const native = resolve(options['--native'] ?? '');
const rounds = Number(options['--rounds'] ?? 10);
if (!desktop || !native || !Number.isInteger(rounds) || rounds < 1) {
  throw new Error('Usage: node benchmark-ui.mjs --desktop /path/ThinkRail.app --native /path/ThinkRailNative.app [--rounds 10]');
}
const root = join(import.meta.dirname, '.bench');
const runDir = join(root, `ui-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
mkdirSync(runDir, {recursive: true});
const probe = join(root, 'window-probe');
execFileSync('clang', ['-O2', '-framework', 'CoreGraphics', '-framework', 'CoreFoundation', join(import.meta.dirname, 'window-probe.m'), '-o', probe]);

function executable(app) {
  const name = execFileSync('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', join(app, 'Contents/Info.plist')], {encoding: 'utf8'}).trim();
  return join(app, 'Contents/MacOS', name);
}
function processes() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,comm='], {encoding: 'utf8'}).split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    return match ? [{pid: Number(match[1]), ppid: Number(match[2]), rssKiB: Number(match[3]), command: match[4]}] : [];
  });
}
function descendants(rows, rootPid) {
  const ids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (ids.has(row.ppid) && !ids.has(row.pid)) { ids.add(row.pid); changed = true; }
  }
  return rows.filter(row => ids.has(row.pid));
}
async function firstWindow(pid) {
  const child = spawn(probe, [String(pid)]);
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  const code = await new Promise(done => child.once('exit', done));
  if (code !== 0) throw new Error(`No regular window for PID ${pid}`);
  return Number(output.trim());
}
async function one(client, round) {
  const before = processes();
  const beforePids = new Set(before.map(row => row.pid));
  const webKitBefore = new Set(before.filter(row => row.command.includes('/WebKit.framework/')).map(row => row.pid));
  const started = Date.now();
  const contentFile = join(runDir, `desktop-${round}.content.json`);
  const readyFile = join(runDir, `desktop-${round}.ready.json`);
  const env = {...process.env, ...client.env, ...(client.name === 'upstream-ui' ? {
    THINKRAIL_DESKTOP_CONTENT_FILE: contentFile, THINKRAIL_DESKTOP_READY_FILE: readyFile,
  } : {})};
  const child = spawn(client.command, [], {env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-65536); });
  const appPrefix = `${dirname(client.command)}/`;
  const newAppPids = () => processes().filter(row => row.command.startsWith(appPrefix) && !beforePids.has(row.pid)).map(row => row.pid);
  try {
    let owner = child.pid;
    if (client.name === 'upstream-ui') {
      const expected = join(dirname(client.command), 'bun');
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const found = processes().find(row => row.command === expected && !beforePids.has(row.pid));
        if (found) { owner = found.pid; break; }
        await new Promise(done => setTimeout(done, 10));
      }
      if (owner === child.pid) throw new Error('Desktop Bun process did not start');
    }
    const windowAt = await firstWindow(owner);
    let contentAt = null;
    let domNodes = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && contentAt === null) {
      if (client.name === 'upstream-ui' && existsSync(contentFile)) {
        try {
          const content = JSON.parse(readFileSync(contentFile, 'utf8'));
          contentAt = content.at;
          domNodes = content.domNodes;
        } catch {}
      } else if (client.name === 'native-ui') {
        const match = log.match(/THINKRAIL_FIRST_CONTENT (\d+)/);
        if (match) contentAt = Number(match[1]);
      }
      if (contentAt === null) await new Promise(done => setTimeout(done, 10));
    }
    if (contentAt === null) throw new Error(`First content not observed: ${log.slice(-1000)}`);
    await new Promise(done => setTimeout(done, Math.max(0, started + 5000 - Date.now())));
    const rows = processes();
    const parent = rows.find(row => row.pid === owner)?.ppid;
    const roots = client.name === 'upstream-ui' && parent && parent !== 1 ? [child.pid, parent] : [child.pid];
    const tree = rows.filter(row => roots.some(rootPid => descendants(rows, rootPid).some(item => item.pid === row.pid)));
    const webKit = client.name === 'upstream-ui' ? rows.filter(row => row.command.includes('/WebKit.framework/') && !webKitBefore.has(row.pid)) : [];
    if (client.name === 'native-ui' && tree.some(row => row.command.endsWith('/thinkrail-host'))) throw new Error('Native host unexpectedly started');
    if (client.name === 'upstream-ui' && log.includes('[host] listening')) throw new Error('Engine host unexpectedly started');
    return {client: client.name, round, launchToWindowMs: Math.round(windowAt - started), launchToContentMs: Math.round(contentAt - started), ...(domNodes === null ? {} : {domNodes}), rss5MiB: Math.round((tree.reduce((sum, row) => sum + row.rssKiB, 0) + webKit.reduce((sum, row) => sum + row.rssKiB, 0)) / 1024)};
  } catch (error) {
    throw new Error(`${client.name} round ${round}: ${error.message}\n${log.slice(-2000)}`);
  } finally {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    for (const pid of newAppPids()) try { process.kill(pid, 'SIGTERM'); } catch {}
    await new Promise(done => setTimeout(done, 300));
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    for (const pid of newAppPids()) try { process.kill(pid, 'SIGKILL'); } catch {}
  }
}
const clients = [
  {name: 'upstream-ui', command: executable(desktop), env: {THINKRAIL_DESKTOP_USER_DATA: join(root, 'ui-desktop-user-data'), THINKRAIL_NO_ANALYTICS: '1'}},
  {name: 'native-ui', command: executable(native), env: {THINKRAIL_PROTOTYPE_HOSTLESS: '1'}},
];
const results = [];
for (let round = 0; round <= rounds; round++) {
  for (let index = 0; index < clients.length; index++) {
    const client = clients[(round + index) % clients.length];
    const result = await one(client, round);
    console.log(JSON.stringify({...result, warmup: round === 0}));
    if (round > 0) results.push(result);
  }
}
const meanSd = values => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  return {mean, sd};
};
const summary = Object.fromEntries(clients.map(client => {
  const own = results.filter(result => result.client === client.name);
  return [client.name, {
    window: meanSd(own.map(row => row.launchToWindowMs)),
    content: meanSd(own.map(row => row.launchToContentMs)),
    rss5: meanSd(own.map(row => row.rss5MiB)),
  }];
}));
const output = {commit: '50d5ac934f576d277f12e8bf34c74c78924d19d4', rounds, clients: {desktop, native}, results, summary};
writeFileSync(join(runDir, 'results.json'), JSON.stringify(output, null, 2));
console.log(JSON.stringify({summary, resultsFile: join(runDir, 'results.json')}));
