import {execFileSync, spawn} from 'node:child_process';
import {existsSync, mkdirSync, statSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {basename, dirname, join, resolve} from 'node:path';
import {footprintMiB} from './footprint.mjs';
import {prepareDesktopProbe} from './prepare-desktop-probe.mjs';

const args = process.argv.slice(2);
const options = Object.fromEntries(args.flatMap((value, index) => index % 2 ? [] : [[value, args[index + 1]]]));
const rounds = Number(options['--rounds'] ?? 10);
function requireAC() {
  const source = execFileSync('pmset', ['-g', 'batt'], {encoding: 'utf8'}).split('\n')[0];
  if (!source.includes("'AC Power'")) throw new Error(`Benchmark requires AC power: ${source}`);
  return source;
}
requireAC();
if (!options['--original'] || !Number.isInteger(rounds) || rounds < 1) {
  console.error('Usage: node compare-desktop-workspace.mjs --original /path/ThinkRail.app [--optimized /path/ThinkRail.app] [--rounds 10]');
  process.exit(2);
}

const project = resolve(options['--project'] ?? join(import.meta.dirname, '../..'));
const root = join(import.meta.dirname, '.bench');
const runDir = join(root, `desktop-workspace-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
mkdirSync(runDir, {recursive: true});
const branch = execFileSync('git', ['-C', project, 'branch', '--show-current'], {encoding: 'utf8'}).trim() || 'main';
const probe = join(root, 'window-probe');
if (!existsSync(probe)) execFileSync('clang', ['-O2', '-framework', 'CoreGraphics', '-framework', 'CoreFoundation', join(import.meta.dirname, 'window-probe.m'), '-o', probe]);

function binary(app) {
  const name = execFileSync('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', join(app, 'Contents/Info.plist')], {encoding: 'utf8'}).trim();
  return join(app, 'Contents/MacOS', name);
}

function fixture(name) {
  const data = join(runDir, `${name}-data`);
  const userData = join(runDir, `${name}-user-data`);
  mkdirSync(data, {recursive: true});
  mkdirSync(userData, {recursive: true});
  writeFileSync(join(data, 'projects.json'), JSON.stringify([{
    id: 'benchmark-project', name: basename(project), path: project, slug: 'benchmark-project', lastOpened: 1, trusted: true,
  }]));
  writeFileSync(join(data, 'workspaces.json'), JSON.stringify([{
    id: 'benchmark-workspace', projectId: 'benchmark-project', kind: 'default', name: 'Benchmark workspace',
    branch, worktreePath: project, baseBranch: branch, diffBase: branch,
  }]));
  writeFileSync(join(data, 'terminals.json'), JSON.stringify({'benchmark-workspace': [{tabKey: 'terminal-1', title: 'Terminal'}]}));
  writeFileSync(join(data, 'config.json'), JSON.stringify({analyticsEnabled: false, analyticsConsentConfirmed: true}));
  writeFileSync(join(userData, 'routes.json'), JSON.stringify({
    version: 1, routes: {'local:main': '#/v1/projects/benchmark-project/workspaces/benchmark-workspace'},
  }));
  return {data, userData};
}

const clients = [
  {name: 'original', source: resolve(options['--original'])},
  ...(options['--optimized'] ? [{name: 'optimized', source: resolve(options['--optimized'])}] : []),
].map(client => {
  const app = prepareDesktopProbe(client.source, join(runDir, `${client.name}.app`));
  return {...client, app, command: binary(app), ...fixture(client.name)};
});

function processes() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], {encoding: 'utf8'}).split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    return match ? [{pid: Number(match[1]), ppid: Number(match[2]), command: match[3]}] : [];
  });
}

function tree(rows, roots) {
  const ids = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (ids.has(row.ppid) && !ids.has(row.pid)) {
      ids.add(row.pid);
      changed = true;
    }
  }
  return rows.filter(row => ids.has(row.pid));
}

async function ownerPid(client, beforePids) {
  const expected = join(dirname(client.command), 'bun');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const owner = processes().find(row => row.command === expected && !beforePids.has(row.pid));
    if (owner) return owner.pid;
    await new Promise(done => setTimeout(done, 20));
  }
  throw new Error('Desktop Bun process did not start');
}

async function firstWindow(pid) {
  const child = spawn(probe, [String(pid)]);
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  const code = await new Promise(done => child.once('exit', done));
  if (code !== 0) throw new Error(`No regular window for PID ${pid}`);
  return Number(output.trim());
}

async function launch(client, round) {
  requireAC();
  const before = processes();
  const beforePids = new Set(before.map(row => row.pid));
  const webKitBefore = new Set(before.filter(row => row.command.includes('/WebKit.framework/')).map(row => row.pid));
  let workspaceAt;
  const marker = createServer((request, response) => {
    const at = Number(new URL(request.url, 'http://127.0.0.1').searchParams.get('at'));
    if (Number.isFinite(at) && at > 0) workspaceAt ??= at;
    response.writeHead(204, {'Access-Control-Allow-Origin': '*'}).end();
  });
  await new Promise(done => marker.listen(0, '127.0.0.1', done));
  const markerURL = `http://127.0.0.1:${marker.address().port}/workspace`;
  const readyFile = join(runDir, `${client.name}-${round}.ready.json`);
  const agentDir = join(runDir, `${client.name}-${round}-pi-agent`);
  mkdirSync(agentDir, {recursive: true});
  writeFileSync(join(client.userData, 'routes.json'), JSON.stringify({
    version: 1, routes: {'local:main': '#/v1/projects/benchmark-project/workspaces/benchmark-workspace'},
  }));
  const startedAt = Date.now();
  let app;
  let log = '';
  try {
    const env = {...process.env, THINKRAIL_DATA_DIR: client.data, THINKRAIL_DESKTOP_USER_DATA: client.userData,
      PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', THINKRAIL_NO_ANALYTICS: '1',
      THINKRAIL_DESKTOP_READY_FILE: readyFile, THINKRAIL_DESKTOP_WORKSPACE_PROBE_URL: markerURL};
    delete env.THINKRAIL_DESKTOP_WARM_HOST_URL;
    app = spawn(client.command, [], {env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
    for (const stream of [app.stdout, app.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-65536); });
    const owner = await ownerPid(client, beforePids);
    const windowAt = await firstWindow(owner);
    const deadline = startedAt + 15000;
    while (!workspaceAt && Date.now() < deadline) await new Promise(done => setTimeout(done, 20));
    if (!workspaceAt) throw new Error('Desktop workspace layout did not mount');
    if (!existsSync(readyFile)) throw new Error('Desktop DOM-ready marker missing');
    await new Promise(done => setTimeout(done, Math.max(0, startedAt + 5000 - Date.now())));
    const rows = processes();
    const ownerParent = rows.find(row => row.pid === owner)?.ppid;
    const roots = ownerParent && ownerParent !== 1 ? [app.pid, ownerParent] : [app.pid];
    const owned = tree(rows, roots);
    const webKit = rows.filter(row => row.command.includes('/WebKit.framework/') && !webKitBefore.has(row.pid));
    const footprint = items => Math.round(footprintMiB(items.map(row => row.pid)));
    requireAC();
    return {client: client.name, round, launchToWindowMs: Math.round(windowAt - startedAt),
      launchToDomReadyMs: Math.round(statSync(readyFile).mtimeMs - startedAt),
      launchToWorkspaceMs: workspaceAt - startedAt,
      at5s: {appFootprintMiB: footprint([...owned, ...webKit]),
        processCount: owned.length + webKit.length}};
  } catch (error) { throw new Error(`${client.name} round ${round}: ${error.message}\n${log.slice(-1500)}`); }
  finally {
    if (app) {
      try { process.kill(-app.pid, 'SIGTERM'); } catch {}
      const appPrefix = `${dirname(client.command)}/`;
      for (const row of processes()) if (row.command.startsWith(appPrefix) && !beforePids.has(row.pid)) {
        try { process.kill(row.pid, 'SIGTERM'); } catch {}
      }
      await new Promise(done => setTimeout(done, 500));
      try { process.kill(-app.pid, 'SIGKILL'); } catch {}
    }
    marker.close();
  }
}

const warmups = [];
const results = [];
for (let round = 0; round <= rounds; round++) {
  for (const client of round % 2 ? clients.toReversed() : clients) {
    const result = await launch(client, round);
    console.log(JSON.stringify({...result, warmup: round === 0}));
    (round ? results : warmups).push(result);
  }
}
const metadata = {macos: execFileSync('sw_vers', ['-productVersion'], {encoding: 'utf8'}).trim(),
  cpu: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], {encoding: 'utf8'}).trim(),
  power: execFileSync('pmset', ['-g', 'batt'], {encoding: 'utf8'}).split('\n')[0],
  baselineCommit: execFileSync('git', ['-C', resolve(options['--original']), 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  original: clients[0].source, optimized: clients[1]?.source ?? null, project, branch};
const resultsFile = join(runDir, 'results.json');
writeFileSync(resultsFile, JSON.stringify({metadata, warmups, results}, null, 2));
console.log(JSON.stringify({resultsFile}));
