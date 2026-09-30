import {execFileSync, spawn} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {basename, join, resolve} from 'node:path';
import {footprintMiB} from './footprint.mjs';

const args = process.argv.slice(2);
const options = Object.fromEntries(args.flatMap((value, index) => index % 2 ? [] : [[value, args[index + 1]]]));
const rounds = Number(options['--rounds'] ?? 10);
if (!options['--native'] || !options['--host'] || !Number.isInteger(rounds) || rounds < 1) {
  console.error('Usage: node compare.mjs --native /path/ThinkRailNative.app --host /path/thinkrail [--project /path/repo] [--rounds 10]');
  process.exit(2);
}

const project = resolve(options['--project'] ?? join(import.meta.dirname, '../..'));
const nativeApp = resolve(options['--native']);
const hostBinary = resolve(options['--host']);
const root = join(import.meta.dirname, '.bench');
const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
const runDir = join(root, runId);
const dataDir = join(runDir, 'host-data');
const hostURL = 'http://127.0.0.1:43423';
function requireAC() {
  const source = execFileSync('pmset', ['-g', 'batt'], {encoding: 'utf8'}).split('\n')[0];
  if (!source.includes("'AC Power'")) throw new Error(`Benchmark requires AC power: ${source}`);
  return source;
}
requireAC();
mkdirSync(dataDir, {recursive: true});
const branch = execFileSync('git', ['-C', project, 'branch', '--show-current'], {encoding: 'utf8'}).trim() || 'main';
writeFileSync(join(dataDir, 'projects.json'), JSON.stringify([{
  id: 'benchmark-project', name: basename(project), path: project, slug: 'benchmark-project', lastOpened: 1, trusted: true,
}]));
writeFileSync(join(dataDir, 'workspaces.json'), JSON.stringify([{
  id: 'benchmark-workspace', projectId: 'benchmark-project', kind: 'default', name: 'Benchmark workspace',
  branch, worktreePath: project, baseBranch: branch, diffBase: branch,
}]));
writeFileSync(join(dataDir, 'terminals.json'), JSON.stringify({'benchmark-workspace': [{tabKey: 'terminal-1', title: 'Terminal'}]}));
writeFileSync(join(dataDir, 'config.json'), JSON.stringify({analyticsEnabled: false, analyticsConsentConfirmed: true}));

const executable = execFileSync('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', join(nativeApp, 'Contents/Info.plist')], {encoding: 'utf8'}).trim();
const nativeBinary = join(nativeApp, 'Contents/MacOS', executable);
const probe = join(root, 'window-probe');
if (!existsSync(probe)) execFileSync('clang', ['-O2', '-framework', 'CoreGraphics', '-framework', 'CoreFoundation', join(import.meta.dirname, 'window-probe.m'), '-o', probe]);

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

async function firstWindow(pid) {
  const child = spawn(probe, [String(pid)]);
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  const code = await new Promise(done => child.once('exit', done));
  if (code !== 0) throw new Error(`No regular window for PID ${pid}`);
  return Number(output.trim());
}

async function hostReady(host, startedAt) {
  while (Date.now() - startedAt < 15000) {
    try { if ((await (await fetch(`${hostURL}/health`)).text()) === 'ok') return Date.now() - startedAt; }
    catch {}
    if (host.exitCode !== null) break;
    await new Promise(done => setTimeout(done, 25));
  }
  throw new Error('Host did not become ready');
}

async function liveWorkbench() {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(`${hostURL.replace(/^http/, 'ws')}/ws?client=benchmark-probe`);
    const timer = setTimeout(() => { socket.close(); reject(new Error('Workbench probe timed out')); }, 3000);
    const checked = new Set();
    socket.onmessage = event => {
      const frame = JSON.parse(String(event.data));
      if (frame.channel === 'server.welcome') {
        for (const [id, method, params] of [
          ['sessions', 'session.list', {workspaceId: 'benchmark-workspace'}],
          ['files', 'fs.readDir', {workspaceId: 'benchmark-workspace', path: '.'}],
          ['git', 'git.status', {workspaceId: 'benchmark-workspace'}],
        ]) socket.send(JSON.stringify({id, method, params}));
      } else if (frame.id) {
        if (!frame.ok) { clearTimeout(timer); socket.close(); reject(new Error(`${frame.id}: ${frame.error}`)); return; }
        if (frame.id === 'sessions' && !frame.result.some(session => session.live)) {
          clearTimeout(timer); socket.close(); reject(new Error('RN did not create a live Pi session')); return;
        }
        if (frame.id === 'files' && !frame.result.length) {
          clearTimeout(timer); socket.close(); reject(new Error('Workspace file tree is empty')); return;
        }
        checked.add(frame.id);
        if (checked.size === 3) { clearTimeout(timer); socket.close(); resolve(true); }
      }
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('Session probe could not connect')); };
  });
}

async function launch(round) {
  requireAC();
  let workspaceAt;
  let workbenchAt;
  const marker = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const at = Number(url.searchParams.get('at'));
    if (Number.isFinite(at) && at > 0) {
      if (url.pathname === '/workspace') workspaceAt ??= at;
      else if (url.pathname === '/ready') workbenchAt ??= at;
    }
    response.writeHead(204).end();
  });
  await new Promise(done => marker.listen(0, '127.0.0.1', done));
  const benchmarkPort = String(marker.address().port);
  const startedAt = Date.now();
  const agentDir = join(runDir, `pi-agent-${round}`);
  mkdirSync(agentDir, {recursive: true});
  const host = spawn(hostBinary, ['--port', '43423', '--host', '127.0.0.1', '--no-open', '--no-analytics', project], {
    env: {...process.env, THINKRAIL_DATA_DIR: dataDir, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', THINKRAIL_NO_ANALYTICS: '1'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const app = spawn(nativeBinary, [], {
    env: {...process.env, THINKRAIL_NATIVE_HOST_URL: hostURL, THINKRAIL_NATIVE_WORKSPACE_ID: 'benchmark-workspace',
      THINKRAIL_NATIVE_BENCHMARK_PORT: benchmarkPort},
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  for (const stream of [app.stdout, app.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-65536); });
  let hostLog = '';
  for (const stream of [host.stdout, host.stderr]) stream.on('data', chunk => { hostLog = (hostLog + chunk).slice(-65536); });
  const readyTask = hostReady(host, startedAt);
  try {
    const windowAt = await firstWindow(app.pid);
    const httpReadyMs = await readyTask;
    await new Promise(done => setTimeout(done, Math.max(0, startedAt + 5000 - Date.now())));
    await liveWorkbench();
    if (!workspaceAt) throw new Error('RN workspace layout did not mount');
    if (!workbenchAt) throw new Error('RN workbench did not mount host data');
    const rows = processes();
    const appTree = tree(rows, [app.pid]);
    const hostTree = tree(rows, [host.pid]);
    const footprint = own => Math.round(footprintMiB(own.map(row => row.pid)));
    const content = log.match(/THINKRAIL_FIRST_CONTENT (\d+)/);
    requireAC();
    return {
      round, launchToWindowMs: Math.round(windowAt - startedAt),
      launchToContentMs: content ? Number(content[1]) - startedAt : null,
      launchToWorkspaceMs: workspaceAt - startedAt,
      launchToWorkbenchMs: workbenchAt - startedAt,
      coldHostHttpReadyMs: httpReadyMs, livePiSession: true,
      at5s: {appFootprintMiB: footprint([...appTree, ...hostTree]), mainFootprintMiB: footprint(appTree),
        hostFootprintMiB: footprint(hostTree), processCount: appTree.length + hostTree.length},
    };
  } catch (error) {
    throw new Error(`Round ${round}: ${error.message}\nApp: ${log.slice(-1500)}\nHost: ${hostLog.slice(-1500)}`);
  } finally {
    try { process.kill(-app.pid, 'SIGTERM'); } catch {}
    host.kill('SIGTERM');
    await new Promise(done => setTimeout(done, 500));
    try { process.kill(-app.pid, 'SIGKILL'); } catch {}
    host.kill('SIGKILL');
    marker.close();
  }
}

const warmup = await launch(0);
console.log(JSON.stringify({...warmup, warmup: true}));
const results = [];
for (let round = 1; round <= rounds; round++) {
  const result = await launch(round);
  results.push(result);
  console.log(JSON.stringify(result));
}
const metadata = {
  macos: execFileSync('sw_vers', ['-productVersion'], {encoding: 'utf8'}).trim(),
  cpu: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], {encoding: 'utf8'}).trim(),
  power: execFileSync('pmset', ['-g', 'batt'], {encoding: 'utf8'}).split('\n')[0],
  nativeApp, hostBinary, project, branch,
};
const resultsFile = join(runDir, 'results.json');
writeFileSync(resultsFile, JSON.stringify({metadata, warmup, results}, null, 2));
console.log(JSON.stringify({resultsFile}));
