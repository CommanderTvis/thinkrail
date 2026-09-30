#!/usr/bin/env node
import {readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
if (args.includes('--help')) {
  console.log('Usage: report.mjs [--dir <results dir>] [--doc <BENCHMARK.md>] [--out <report.html>]');
  process.exit(0);
}
const dir = resolve(option('--dir', import.meta.dirname));
const out = resolve(option('--out', join(dir, 'benchmark-report.html')));
const doc = readFileSync(resolve(option('--doc', join(dir, 'BENCHMARK.md'))), 'utf8');

const escapeHTML = text => String(text).replace(/[&<>"]/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[char]));
const inline = text => escapeHTML(text)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
const plain = text => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

// BENCHMARK.md is the single source for prose: blocks are headings, pipe tables, bullet lists and paragraphs.
const blocks = doc.split(/\n{2,}/).flatMap(chunk => {
  const lines = chunk.split('\n').filter(line => line.trim());
  if (!lines.length) return [];
  if (/^#{1,6} /.test(lines[0])) return [{type: 'heading', level: lines[0].match(/^#+/)[0].length, text: lines[0].replace(/^#+ /, '')}];
  if (lines[0].startsWith('|')) return [{type: 'table', rows: lines.filter(line => !/^\|[\s:|-]+\|$/.test(line)).map(line => line.trim().slice(1, -1).split('|').map(cell => cell.trim()))}];
  if (lines.every(line => line.startsWith('- '))) return [{type: 'list', items: lines.map(line => line.slice(2))}];
  return [{type: 'paragraph', text: lines.join(' ')}];
});
const tableAt = blocks.findIndex(block => block.type === 'table');
const title = blocks.find(block => block.type === 'heading' && block.level === 1).text;
const intro = blocks.slice(blocks.findIndex(block => block.type === 'heading' && block.level === 2) + 1, tableAt);
const docRows = blocks[tableAt].rows.slice(1);
const describe = pattern => {
  const cells = docRows.find(row => pattern.test(plain(row[0])));
  if (!cells) throw new Error(`BENCHMARK.md has no table row matching ${pattern}`);
  return {name: plain(cells[0]), note: `${inline(cells[1])} · ${inline(cells[2])}`};
};
const blockHTML = block => {
  if (block.type === 'heading') return `<h${block.level + 1}>${inline(block.text)}</h${block.level + 1}>`;
  if (block.type === 'paragraph') return `<p>${inline(block.text)}</p>`;
  if (block.type === 'list') return `<ul>${block.items.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`;
  const [head, ...body] = block.rows;
  return `<table><thead><tr>${head.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
};

const load = name => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const stat = values => {
  const numbers = values.filter(Number.isFinite);
  if (!numbers.length) return null;
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const sd = numbers.length > 1 ? Math.sqrt(numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (numbers.length - 1)) : 0;
  return {mean, sd, n: numbers.length};
};
const of = (rows, pick) => stat(rows.map(pick));

// milestones: independent moments measured from the same t0, drawn in time order on the UI lane.
// host: a process running alongside the UI, drawn as its own lane. uiWaitsForHost: the UI is launched only after the host is ready.
const rows = [];
{
  const results = load('benchmark-results-desktop-workspace-ac.json').results.filter(row => row.client === 'original');
  const windowStat = of(results, row => row.launchToWindowMs);
  rows.push({
    hostGate: {bound: windowStat.mean, steps: [
      'import host bundle', 'init logging', 'shell env (sync login-shell probe if PATH is incomplete)', 'prepare Pi runtime',
      'Bun.serve on port 0', 'window created with that port', 'UI assets + WebSocket served by the same host'].map(step => escapeHTML(step)).join(' → ')},
    ...describe(/upstream/i),
    milestones: [
      {key: 'window', label: 'first window', ...of(results, row => row.launchToWindowMs)},
      {key: 'layout', label: 'workspace layout', ...of(results, row => row.launchToWorkspaceMs)},
    ],
    footprint: of(results, row => row.at5s.appFootprintMiB), source: 'benchmark-results-desktop-workspace-ac.json',
  });
}
{
  const results = load('benchmark-results-rn-unoptimized-bun-ac.json').results;
  rows.push({
    ...describe(/React Native/i),
    milestones: [
      {key: 'window', label: 'first window', ...of(results, row => row.launchToWindowMs)},
      {key: 'content', label: 'first content', ...of(results, row => row.launchToContentMs)},
      {key: 'layout', label: 'workspace layout', ...of(results, row => row.launchToWorkspaceMs)},
    ],
    host: {label: 'host ready', ...of(results, row => row.coldHostHttpReadyMs)},
    footprint: of(results, row => row.at5s.appFootprintMiB), hostFootprint: of(results, row => row.at5s.hostFootprintMiB),
    source: 'benchmark-results-rn-unoptimized-bun-ac.json',
  });
}
for (const mode of ['embedded', 'remote']) {
  const {samples} = load(`benchmark-results-sharprail-${mode}-ac.json`);
  rows.push({
    ...describe(new RegExp(`Sharprail ${mode}`, 'i')),
    milestones: [
      {key: 'window', label: 'first window', ...of(samples, sample => sample.firstWindowMs)},
      {key: 'layout', label: 'workspace layout', ...of(samples, sample => sample.workspaceLayoutMs)},
    ],
    host: mode === 'remote' ? {label: 'host ready', ...of(samples, sample => sample.hostReadyMs)} : undefined,
    uiWaitsForHost: mode === 'remote',
    footprint: of(samples, sample => sample.totalFootprintMiB), hostFootprint: of(samples, sample => sample.hostFootprintMiB),
    source: `benchmark-results-sharprail-${mode}-ac.json`,
  });
}
{
  const results = load('benchmark-results-zed-footprint.json').results;
  rows.push({
    ...describe(/^Zed/),
    milestones: [{key: 'window', label: 'first window', ...of(results, row => row.launchToWindowMs)}],
    footprint: of(results, row => row.footprintMiB), source: 'benchmark-results-zed-footprint.json',
  });
}
{
  const results = load('benchmark-results-air-footprint.json').results;
  rows.push({
    ...describe(/Air/),
    milestones: [{key: 'window', label: 'first window', ...of(results, row => row.launchToWindowMs)}],
    footprint: of(results, row => row.footprintMiB), source: 'benchmark-results-air-footprint.json',
  });
}

const segments = row => {
  const list = [];
  let at = 0;
  if (row.uiWaitsForHost && row.host) {
    list.push({from: 0, to: row.host.mean, kind: 'wait', label: 'waiting for host'});
    at = row.host.mean;
  }
  for (const milestone of [...row.milestones].filter(m => m).sort((a, b) => a.mean - b.mean)) {
    list.push({from: at, to: milestone.mean, kind: milestone.key, label: `→ ${milestone.label}`, milestone});
    at = milestone.mean;
  }
  return list;
};

const fmt = value => value ? `${value.mean.toFixed(0)} ± ${value.sd.toFixed(0)}` : '—';
const end = row => Math.max(...row.milestones.map(m => m.mean), row.host?.mean ?? 0);
const axisMax = Math.ceil(Math.max(...rows.map(end)) / 250) * 250;
const pct = ms => (ms / axisMax * 100).toFixed(3);
const laneHTML = (label, parts, tail) => `<div class="lane"><span class="lane-label">${label}</span><div class="track">${parts.map(part =>
  `<div class="seg ${part.kind}" style="left:${pct(part.from)}%;width:${pct(part.to - part.from)}%" title="${escapeHTML(part.title)}">${part.text}</div>`).join('')}${tail ?? ''}</div></div>`;

const whisker = stat => stat && stat.sd ? `<span class="whisker" style="left:${pct(stat.mean - stat.sd)}%;width:${pct(2 * stat.sd)}%" title="± ${stat.sd.toFixed(0)} ms (1 sample std dev)"></span>` : '';
const labelFor = (label, ms) => `<span class="full">${escapeHTML(label)} · ${ms.toFixed(0)} ms</span><span class="short">${ms.toFixed(0)} ms</span>`;

const rowHTML = row => {
  const ui = segments(row);
  const total = Math.max(...row.milestones.map(m => m.mean));
  const uiParts = ui.map(segment => ({
    ...segment, text: labelFor(segment.label, segment.to - segment.from),
    title: `${segment.label}: ${segment.from.toFixed(0)}–${segment.to.toFixed(0)} ms${segment.milestone ? ` (${fmt(segment.milestone)} ms from launch)` : ''}`,
  }));
  let level = 0;
  let previous = -Infinity;
  const placed = ui.filter(segment => segment.milestone).map(segment => {
    level = segment.to - previous < axisMax * 0.16 ? level + 1 : 0;
    previous = segment.to;
    return {segment, level};
  });
  const marks = placed.map(({segment, level}) =>
    `<span class="mark" style="left:${pct(segment.to)}%;top:${2 + level * 32}px">${escapeHTML(segment.milestone.label)}<b>${segment.milestone.mean.toFixed(0)} ms</b></span>`).join('');
  const marksHeight = 4 + 32 * (Math.max(0, ...placed.map(mark => mark.level)) + 1);
  let hostLane = '';
  if (row.host) {
    const tail = row.host.mean < total ? `<div class="seg serving" style="left:${pct(row.host.mean)}%;width:${pct(total - row.host.mean)}%" title="host running alongside the UI"></div>` : '';
    hostLane = laneHTML('↳ host, separate', [{from: 0, to: row.host.mean, kind: 'host', text: labelFor('starting', row.host.mean), title: `host ready ${fmt(row.host)} ms from launch`}], tail + whisker(row.host));
  }
  if (row.hostGate) {
    hostLane = laneHTML('↳ host, embedded', [{from: 0, to: row.hostGate.bound, kind: 'gate', text: labelFor('host boot, upper bound', row.hostGate.bound),
      title: `The window is created only after the host is listening, so host boot ends no later than first window (${row.hostGate.bound.toFixed(0)} ms). Stage durations are not measured.`}])
      + `<div class="steps">gate chain (code order, durations not measured): ${row.hostGate.steps}</div>`;
  }
  const lastSd = row.milestones.find(m => m.mean === total)?.sd ?? 0;
  const value = `<span class="end" style="left:${pct(total + lastSd)}%">${total.toFixed(0)} ms</span>`;
  return `<div class="entry">${laneHTML(`<b>${escapeHTML(row.name)}</b>`, uiParts, value + row.milestones.map(whisker).join(''))}${hostLane}<div class="marks" style="height:${marksHeight}px">${marks}</div></div>`;
};

const ticks = Array.from({length: axisMax / 250 + 1}, (_, i) => i * 250).map(ms => `<span style="left:${pct(ms)}%">${ms}</span>`).join('');
const memRows = rows.filter(row => row.footprint);
const memMax = Math.ceil(Math.max(...memRows.map(row => row.footprint.mean + row.footprint.sd)) / 250) * 250;
const memPct = mib => (mib / memMax * 100).toFixed(3);
const memChart = `<section class="mem"><h2>Footprint at five seconds, MiB</h2><div class="plot">${
  Array.from({length: memMax / 250 + 1}, (_, i) => `<i class="gl" style="bottom:${memPct(i * 250)}%"><span>${i * 250}</span></i>`).join('')}${memRows.map(row => {
    const {mean, sd} = row.footprint;
    const host = row.hostFootprint?.mean ?? 0;
    return `<div class="col" title="${escapeHTML(row.name)}: ${fmt(row.footprint)} MiB${host ? `, host ${fmt(row.hostFootprint)}` : ''}">
<div class="bar app" style="height:${memPct(mean - host)}%;bottom:${memPct(host)}%"></div>${host ? `<div class="bar hostpart" style="height:${memPct(host)}%"></div>` : ''}
<div class="err" style="bottom:${memPct(mean - sd)}%;height:${memPct(2 * sd)}%"></div>
<span class="val" style="bottom:${memPct(mean + sd)}%">${mean.toFixed(0)}</span>
<span class="name">${escapeHTML(row.name)}</span></div>`;
  }).join('')}</div><p class="legend"><span><i style="background:var(--window)"></i>app / UI process tree</span><span><i style="background:var(--host)"></i>separate host process tree</span><span>whiskers: ± 1 sample std dev of the total</span></p></section>`;
const gridLines = Array.from({length: axisMax / 250 + 1}, (_, i) => `<i style="left:${pct(i * 250)}%"></i>`).join('');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(title)}</title>
<style>
:root{--bg:#fff;--fg:#1c1c1e;--muted:#6b6b70;--line:#d9d9de;--wait:#c8c8cf;--host:#4f7cff;--serving:#4f7cff33;--window:#f59e42;--content:#2fb5a5;--layout:#3fae5a;--label:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececee;--muted:#9a9aa1;--line:#333338;--wait:#4a4a52;--host:#5f8cff;--serving:#5f8cff33;--window:#d98428;--content:#25968a;--layout:#33954b}}
body{margin:0;padding:24px 16px 48px;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 20px}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 0 20px;color:var(--muted);font-size:13px}.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}
h2{font-size:16px;margin:0}header p{margin:0 0 10px;color:var(--muted);font-size:13px}
.lane{display:flex;align-items:center;gap:8px;margin:4px 0}.lane-label{flex:0 0 var(--lw,84px);color:var(--muted);font-size:12px;text-align:right}
.track,.axis,.marks{position:relative;flex:1}.track{height:26px;background:transparent;border-left:1px solid var(--line)}
.seg{position:absolute;top:0;height:100%;box-sizing:border-box;border-right:2px solid var(--bg);color:var(--label);font-size:12px;line-height:26px;overflow:hidden;white-space:nowrap}
.seg{container-type:inline-size}.seg span{padding:0 6px;display:none}@container (min-width:56px){.seg .short{display:inline}}@container (min-width:210px){.seg .short{display:none}.seg .full{display:inline}}.seg.host{background:var(--host)}.seg.serving{background:var(--serving);border:0}.seg.wait{background:repeating-linear-gradient(45deg,var(--wait) 0 6px,transparent 6px 12px);color:var(--fg)}
.seg.window{background:var(--window)}.seg.content{background:var(--content)}.seg.layout{background:var(--layout)}
.lanes{position:relative}.marks{margin-left:calc(var(--lw,84px) + 8px);flex:none}.mark{position:absolute;top:2px;transform:translateX(-100%);padding-right:4px;font-size:11px;color:var(--muted);text-align:right;border-right:1px solid var(--line);line-height:1.2}.mark b{display:block;color:var(--fg);font-weight:600}
dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:2px 0 0 calc(var(--lw,84px) + 8px);font-size:12px;color:var(--muted)}dt{color:var(--muted)}dd{margin:0;color:var(--fg)}
.axis{height:18px;margin:14px 0 0 calc(var(--lw,84px) + 8px);flex:none;border-top:1px solid var(--line)}.axis span{position:absolute;top:2px;transform:translateX(-50%);font-size:11px;color:var(--muted)}
.doc{margin-top:32px;border-top:1px solid var(--line);color:var(--fg)}.doc h2{font-size:18px;margin:24px 0 6px}.doc p,.doc li{font-size:13px;color:var(--muted)}.doc table{border-collapse:collapse;font-size:12px}.doc th,.doc td{border:1px solid var(--line);padding:3px 8px;text-align:left}.doc a,.row a{color:inherit}code{font-size:12px}
.axis.top{margin-bottom:8px;border-top:0;border-bottom:1px solid var(--line);height:20px}.axis.top span{top:0}
.overview{position:relative;margin:0 0 20px}.grid{position:absolute;top:0;bottom:0;left:calc(var(--lw) + 8px);right:0;pointer-events:none}.grid i{position:absolute;top:0;bottom:0;border-left:1px dashed var(--line)}.entry{padding:6px 0 0;border-top:1px solid var(--line)}.lane-label b{color:var(--fg);font-size:13px}.details{border-collapse:collapse;font-size:12px;width:100%}.details th,.details td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}.details a{color:inherit}.seg.gate{background:transparent;border:2px dashed var(--host);color:var(--fg)}.legend i.gate{background:transparent;border:2px dashed var(--host);width:8px;height:8px}.steps{position:relative;margin:0 0 2px calc(var(--lw,84px) + 8px);font-size:11px;color:var(--muted)}.end{position:absolute;top:0;margin-left:8px;font-size:12px;line-height:26px;color:var(--fg);white-space:nowrap}.overview .axis.top{margin-bottom:6px}
.mem{margin:8px 0 28px}.mem h2{margin:0 0 12px}.plot{position:relative;height:320px;margin:0 0 70px 44px;display:flex;align-items:stretch;justify-content:space-around;border-left:1px solid var(--line);border-bottom:1px solid var(--line)}
.gl{position:absolute;left:0;right:0;border-top:1px dashed var(--line)}.gl span{position:absolute;left:-44px;width:38px;text-align:right;top:-8px;font-size:11px;color:var(--muted)}
.col{position:relative;flex:0 0 12%}.bar{position:absolute;left:15%;right:15%;bottom:0}.bar.app{background:var(--window)}.bar.hostpart{background:var(--host)}
.err{position:absolute;left:50%;width:14px;margin-left:-7px;border:1.5px solid var(--fg);border-left:0;border-right:0;box-sizing:border-box}.err::before{content:'';position:absolute;left:50%;top:0;bottom:0;border-left:1.5px solid var(--fg)}
.val{position:absolute;left:0;right:0;margin-bottom:4px;text-align:center;font-size:12px;font-weight:600}.name{position:absolute;top:100%;left:-10%;right:-10%;margin-top:6px;text-align:center;font-size:12px;color:var(--muted)}
.whisker{position:absolute;top:50%;height:12px;margin-top:-6px;box-sizing:border-box;border-left:1.5px solid var(--fg);border-right:1.5px solid var(--fg);background:linear-gradient(var(--fg),var(--fg)) center/100% 1.5px no-repeat;z-index:2;pointer-events:auto}
.notes{margin-top:28px;color:var(--muted);font-size:13px}.notes li{margin:4px 0}
</style></head><body><main>
<h1>${escapeHTML(title)}</h1>
${intro.map(blockHTML).join('\n')}
<p class="sub">Bars show means from the result files, in milliseconds from launch; all descriptions are copied from BENCHMARK.md. Generated ${new Date().toISOString()}.</p>
<div class="legend"><span><i style="background:var(--window)"></i>to first window</span><span><i style="background:var(--content)"></i>to first content</span><span><i style="background:var(--layout)"></i>to workspace layout</span><span><i style="background:var(--host)"></i>host starting</span><span><i style="background:var(--wait);"></i>UI waiting for host</span><span><i class="gate"></i>host boot, upper bound (embedded)</span><span>├─┤ ±1 sample std dev</span></div>
<section class="overview" style="--lw:220px"><div class="grid">${gridLines}</div><div class="axis top">${ticks}</div>
${rows.map(rowHTML).join('\n')}
<div class="axis">${ticks}</div></section>
${memChart}
<table class="details"><thead><tr><th>Client</th><th>Stack · host / workload</th><th>Footprint</th><th>Source</th></tr></thead><tbody>${rows.map(row =>
  `<tr><td>${escapeHTML(row.name)}</td><td>${row.note}</td><td>${row.footprint ? `${fmt(row.footprint)} MiB${row.hostFootprint ? ` (host ${fmt(row.hostFootprint)})` : ''}` : '—'}</td><td>${escapeHTML(row.source)}</td></tr>`).join('')}</tbody></table>
<ul class="notes">
<li>Segments on the “window + UI” lane run between consecutive milestones in time order; each is coloured by the milestone it ends at. Milestones are independent measurements, so their order can differ per client (Sharprail commits layout before the OS lists its window).</li>
<li>The “host” lane is a separate process running in parallel with the UI. RN starts host and UI together; Sharprail remote launches the UI only after the host is ready, so the UI lane starts with a hatched wait. Embedded hosts have no separate timer; upstream’s dashed lane is only an upper bound: its window is created after the host is listening, so host boot ends no later than first window. The gate chain under it is read from the code (<code>apps/desktop/src/index.ts</code>, <code>packages/server/src/host/boot.ts</code>), and its stage durations are not measured.</li>
</ul>
<section class="doc">${blocks.slice(tableAt + 1).map(blockHTML).join('\n')}</section></main></body></html>
`;
writeFileSync(out, html);

const pad = (text, width) => String(text).padEnd(width);
console.log(`${pad('client', 34)}${pad('host ready', 14)}${pad('first window', 14)}${pad('layout', 14)}footprint MiB`);
for (const row of rows) {
  const milestone = key => row.milestones.find(m => m.key === key);
  console.log(`${pad(row.name, 34)}${pad(fmt(row.host), 14)}${pad(fmt(milestone('window')), 14)}${pad(fmt(milestone('layout')), 14)}${fmt(row.footprint)}`);
}
console.log(`\nWrote ${out}`);
