import {spawn, execFileSync} from 'node:child_process';
import {join, resolve} from 'node:path';

const app = resolve(process.argv[2] ?? '');
const runs = Number(process.argv[3] ?? 5);
if (!app.endsWith('.app') || !Number.isInteger(runs) || runs < 1) {
  console.error('Usage: node measure.mjs /path/to/ThinkRailNative.app [runs]');
  process.exit(2);
}

const executable = execFileSync('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', join(app, 'Contents/Info.plist')], {encoding: 'utf8'}).trim();
const binary = join(app, 'Contents/MacOS', executable);
const hostBinary = join(app, 'Contents/Resources/thinkrail-host');
const results = [];

function hostPids() {
  return execFileSync('ps', ['-axo', 'pid=,comm='], {encoding: 'utf8'}).split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return match && match[2] === hostBinary ? [Number(match[1])] : [];
  });
}

function rss(pid) {
  try {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], {encoding: 'utf8'}).split('\n').flatMap(line => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
      return match ? [{pid: Number(match[1]), ppid: Number(match[2]), rss: Number(match[3])}] : [];
    });
    const ids = new Set([pid]);
    let size = 0;
    for (let changed = true; changed;) {
      changed = false;
      for (const row of rows) if (ids.has(row.ppid) && !ids.has(row.pid)) {
        ids.add(row.pid);
        changed = true;
      }
    }
    for (const row of rows) if (ids.has(row.pid)) size += row.rss;
    return size;
  } catch {
    return null;
  }
}

async function measure() {
  const existingHosts = new Set(hostPids());
  const launchedAt = Date.now();
  const child = spawn(binary, [], {detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  const firstContent = new Promise((resolveContent, rejectContent) => {
    const timer = setTimeout(() => rejectContent(new Error('No first-content marker within 60 seconds')), 60000);
    function receive(chunk) {
      output += chunk.toString();
      const main = output.match(/THINKRAIL_NATIVE_MAIN (\d+)/);
      const ready = output.match(/THINKRAIL_FIRST_CONTENT (\d+)/);
      if (main && ready) {
        clearTimeout(timer);
        resolveContent({main: Number(main[1]), ready: Number(ready[1])});
      }
    }
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.once('error', rejectContent);
    child.once('exit', code => rejectContent(new Error(`App exited before first content (${code}): ${output.slice(-2000)}`)));
  });
  try {
    const {main, ready} = await firstContent;
    const rssAtContentKiB = rss(child.pid);
    await new Promise(resolveDelay => setTimeout(resolveDelay, 5000));
    const rssAfter5sKiB = rss(child.pid);
    return {launchToContentMs: ready - launchedAt, mainToContentMs: ready - main, rssAtContentMiB: rssAtContentKiB === null ? null : Math.round(rssAtContentKiB / 1024), rssAfter5sMiB: rssAfter5sKiB === null ? null : Math.round(rssAfter5sKiB / 1024)};
  } finally {
    const launchedHosts = hostPids().filter(pid => !existingHosts.has(pid));
    if (child.exitCode === null && child.signalCode === null) {
      process.kill(-child.pid, 'SIGTERM');
      await new Promise(resolveExit => child.once('exit', resolveExit));
    }
    for (const pid of launchedHosts) try { process.kill(pid, 'SIGTERM'); } catch {}
  }
}

for (let i = 0; i < runs; i++) {
  const result = await measure();
  results.push(result);
  console.log(JSON.stringify({run: i + 1, ...result}));
}

const median = key => results.map(result => result[key]).sort((a, b) => a - b)[Math.floor(results.length / 2)];
console.log(JSON.stringify({median: {launchToContentMs: median('launchToContentMs'), mainToContentMs: median('mainToContentMs'), rssAtContentMiB: median('rssAtContentMiB'), rssAfter5sMiB: median('rssAfter5sMiB')}}));
