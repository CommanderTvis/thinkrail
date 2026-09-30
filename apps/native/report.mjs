#!/usr/bin/env node
import {readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
if (args.includes('--help')) {
  console.log('Usage: report.mjs [--dir <results dir>] [--doc <BENCHMARK.md>] [--out <report.html>]; also writes benchmark-startup.svg and benchmark-footprint.svg beside it');
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
// host: a process running alongside the UI, drawn as its own lane.
const rows = [];
{
  const results = load('benchmark-results-desktop-workspace-ac.json').results.filter(row => row.client === 'original');
  const windowStat = of(results, row => row.launchToWindowMs);
  rows.push({
    hostGate: {bound: windowStat.mean, steps: [
      'import host bundle', 'init logging', 'install crash log', 'shell env (sync login-shell probe)', 'initialize JetBrains provider runtime',
      'Bun.serve on port 0', 'window created with that port', 'UI assets + WebSocket served by the same host']},
    ...describe(/upstream/i),
    milestones: [
      {key: 'window', label: 'first window', ...of(results, row => row.launchToWindowMs)},
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
    ],
    host: {label: 'host ready', ...of(results, row => row.coldHostHttpReadyMs)},
    footprint: of(results, row => row.at5s.appFootprintMiB), hostFootprint: of(results, row => row.at5s.hostFootprintMiB),
    source: 'benchmark-results-rn-unoptimized-bun-ac.json',
  });
}
{
  const {samples} = load('benchmark-results-sharprail-fork-embedded-ac.json');
  rows.push({
    ...describe(/Sharprail.*fork/i),
    milestones: [
      {key: 'window', label: 'first window', ...of(samples, sample => sample.firstWindowMs)},
    ],
    footprint: of(samples, sample => sample.totalFootprintMiB),
    source: 'benchmark-results-sharprail-fork-embedded-ac.json',
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

{
  const results = load('benchmark-results-intellij-community.json').results;
  rows.push({
    ...describe(/IntelliJ IDEA Community/),
    milestones: [{key: 'window', label: 'first window', ...of(results, row => row.launchToWindowMs)}],
    footprint: of(results, row => row.footprintMiB), source: 'benchmark-results-intellij-community.json',
  });
}

const segments = row => {
  const list = [];
  let at = 0;
  for (const milestone of [...row.milestones].sort((a, b) => a.mean - b.mean)) {
    list.push({from: at, to: milestone.mean, kind: milestone.key, label: `→ ${milestone.label}`, milestone});
    at = milestone.mean;
  }
  return list;
};

const fmt = value => value ? `${value.mean.toFixed(0)} ± ${value.sd.toFixed(0)}` : '—';
const end = row => Math.max(...row.milestones.map(m => m.mean + m.sd), row.host ? row.host.mean + row.host.sd : 0);
const axisMax = Math.ceil(Math.max(...rows.map(row => end(row) + 60)) / 250) * 250;

const svgStyle = `<style>
.bench{--bg:#fff;--fg:#1c1c1e;--muted:#6b6b70;--line:#d9d9de;--host:#4f7cff;--window:#f59e42;--content:#2fb5a5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
@media(prefers-color-scheme:dark){.bench{--bg:#161618;--fg:#ececee;--muted:#9a9aa1;--line:#333338;--host:#5f8cff;--window:#d98428;--content:#25968a}}
.bench .bg{fill:var(--bg)}.bench text{fill:var(--fg);font-size:12px}.bench .muted{fill:var(--muted)}.bench .small{font-size:11px}.bench .name{font-size:13px;font-weight:600}.bench .title{font-size:15px;font-weight:600}.bench .bold{font-weight:600}.bench .on{fill:#fff}
.bench .grid{stroke:var(--line);stroke-dasharray:3 3}.bench .rule{stroke:var(--line)}.bench .err{stroke:var(--fg);stroke-width:1.5;fill:none}
.bench .window{fill:var(--window)}.bench .content{fill:var(--content)}.bench .host{fill:var(--host)}.bench .serving{fill:var(--host);fill-opacity:.2}.bench .gate{fill:none;stroke:var(--host);stroke-width:2;stroke-dasharray:5 4}
</style>`;
const svgOpen = (width, height, label) => `<svg xmlns="http://www.w3.org/2000/svg" class="bench" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHTML(label)}">${svgStyle}<rect class="bg" width="${width}" height="${height}"/>`;
const textWidth = (text, size = 12) => text.length * size * 0.56;
const text = (x, y, content, cls = '', anchor = 'start') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="${cls}" text-anchor="${anchor}">${escapeHTML(content)}</text>`;
const legend = (items, x, y) => {
  let at = x;
  return items.map(([swatch, label]) => {
    const part = `${swatch(at, y - 10)}${text(at + 18, y, label, 'muted')}`;
    at += 18 + textWidth(label) + 22;
    return part;
  }).join('');
};
const box = cls => (x, y) => `<rect x="${x}" y="${y}" width="12" height="12" rx="2" class="${cls}"/>`;

function startupSVG() {
  const width = 1200, left = 250, right = 1130, barHeight = 24;
  const x = ms => left + ms / axisMax * (right - left);
  const whisker = (stat, y) => !stat?.sd ? '' : `<path class="err" d="M${x(stat.mean - stat.sd).toFixed(1)} ${y - 6}v12M${x(stat.mean + stat.sd).toFixed(1)} ${y - 6}v12M${x(stat.mean - stat.sd).toFixed(1)} ${y}H${x(stat.mean + stat.sd).toFixed(1)}"><title>± ${stat.sd.toFixed(0)} ms (1 sample std dev)</title></path>`;
  const bar = (from, to, y, cls, label, tip) => {
    const w = x(to) - x(from), ms = `${(to - from).toFixed(0)} ms`, full = `${label} · ${ms}`;
    const shown = w > textWidth(full) + 14 ? full : w > textWidth(ms) + 10 ? ms : '';
    return `<g><title>${escapeHTML(tip)}</title><rect x="${x(from).toFixed(1)}" y="${y}" width="${Math.max(0, w - 2).toFixed(1)}" height="${barHeight}" class="${cls}"/>${
      shown ? text(x(from) + 6, y + 16, shown, cls === 'gate' ? '' : 'on') : ''}</g>`;
  };
  let y = 78;
  const body = rows.map(row => {
    const top = y, parts = [];
    const total = Math.max(...row.milestones.map(m => m.mean));
    const lastSd = row.milestones.find(m => m.mean === total)?.sd ?? 0;
    const ui = segments(row);
    y += 10;
    parts.push(text(left - 10, y + 16, row.name, 'name', 'end'));
    for (const segment of ui) parts.push(bar(segment.from, segment.to, y, segment.kind, segment.label,
      `${segment.label}: ${segment.from.toFixed(0)}–${segment.to.toFixed(0)} ms${segment.milestone ? ` (${fmt(segment.milestone)} ms from launch)` : ''}`));
    for (const milestone of row.milestones) parts.push(whisker(milestone, y + barHeight / 2));
    parts.push(text(x(total + lastSd) + 8, y + 16, `${total.toFixed(0)} ms`));
    y += barHeight + 4;
    if (row.host) {
      parts.push(text(left - 10, y + 16, '↳ separate host, same as upstream', 'muted', 'end'));
      if (row.host.mean < total) parts.push(`<rect x="${x(row.host.mean).toFixed(1)}" y="${y}" width="${(x(total) - x(row.host.mean)).toFixed(1)}" height="${barHeight}" class="serving"><title>host running alongside the UI</title></rect>`);
      parts.push(bar(0, row.host.mean, y, 'host', 'starting', `host ready ${fmt(row.host)} ms from launch`), whisker(row.host, y + barHeight / 2));
      y += barHeight + 4;
    }
    if (row.hostGate) {
      parts.push(text(left - 10, y + 16, '↳ host, embedded', 'muted', 'end'));
      parts.push(`<g><title>The window is created only after the host is listening, so host boot ends no later than first window. Stage durations are not measured.</title><rect x="${(x(0) + 1).toFixed(1)}" y="${y + 1}" width="${(x(row.hostGate.bound) - x(0) - 3).toFixed(1)}" height="${barHeight - 2}" class="gate"/>${text(x(0) + 8, y + 16, `host boot, upper bound · ${row.hostGate.bound.toFixed(0)} ms`)}</g>`);
      y += barHeight + 6;
      const lines = [[]];
      for (const step of ['gate chain (code order, durations not measured):', ...row.hostGate.steps.map((step, i) => (i ? '→ ' : '') + step)]) {
        if (textWidth([...lines.at(-1), step].join(' '), 11) > right - left) lines.push([]);
        lines.at(-1).push(step);
      }
      for (const line of lines) { y += 13; parts.push(text(left, y, line.join(' '), 'muted small')); }
      y += 4;
    }
    let level = 0, previous = -Infinity, levels = 0;
    for (const segment of ui.filter(segment => segment.milestone)) {
      level = x(segment.to) - previous < 110 ? level + 1 : 0;
      previous = x(segment.to);
      levels = Math.max(levels, level + 1);
      const at = y + 4 + level * 30, tick = x(segment.to);
      parts.push(`<line class="rule" x1="${tick.toFixed(1)}" x2="${tick.toFixed(1)}" y1="${at}" y2="${at + 26}"/>`,
        text(tick - 5, at + 11, segment.milestone.label, 'muted small', 'end'), text(tick - 5, at + 24, `${segment.milestone.mean.toFixed(0)} ms`, 'small bold', 'end'));
    }
    y += 4 + levels * 30 + 6;
    return `<line class="rule" x1="20" x2="${width - 20}" y1="${top}" y2="${top}"/>${parts.join('')}`;
  }).join('');
  const bottom = y + 4;
  const ticks = Array.from({length: axisMax / 250 + 1}, (_, i) => i * 250);
  const axis = ticks.map(ms => `<line class="grid" x1="${x(ms)}" x2="${x(ms)}" y1="74" y2="${bottom}"/>${text(x(ms), 68, String(ms), 'muted small', 'middle')}${text(x(ms), bottom + 16, String(ms), 'muted small', 'middle')}`).join('');
  return `${svgOpen(width, bottom + 30, 'Startup timeline per client')}
${text(20, 24, 'First window, milliseconds from launch (mean of ten launches)', 'title')}
${legend([[box('window'), 'to first window'], [box('content'), 'to first content'], [box('host'), 'host starting'], [box('gate'), 'host boot, upper bound'],
    [(lx, ly) => `<path class="err" d="M${lx} ${ly}v12M${lx + 14} ${ly}v12M${lx} ${ly + 6}h14"/>`, '±1 sample std dev']], 20, 48)}
${axis}${body}<line class="rule" x1="20" x2="${width - 20}" y1="${bottom}" y2="${bottom}"/></svg>`;
}

function footprintSVG() {
  const width = 1200, height = 440, left = 60, right = 1180, top = 70, base = 350;
  const data = rows.filter(row => row.footprint);
  const max = Math.ceil(Math.max(...data.map(row => row.footprint.mean + row.footprint.sd)) / 250) * 250;
  const y = mib => base - mib / max * (base - top);
  const slot = (right - left) / data.length;
  const grid = Array.from({length: max / 250 + 1}, (_, i) => i * 250).map(mib =>
    `<line class="grid" x1="${left}" x2="${right}" y1="${y(mib)}" y2="${y(mib)}"/>${text(left - 8, y(mib) + 4, String(mib), 'muted small', 'end')}`).join('');
  const bars = data.map((row, i) => {
    const {mean, sd} = row.footprint, host = row.hostFootprint?.mean ?? 0;
    const center = left + slot * (i + 0.5), w = slot * 0.5, x0 = center - w / 2;
    const words = row.name.split(' '), cut = Math.ceil(words.length / 2);
    const name = words.length > 2 ? [words.slice(0, cut).join(' '), words.slice(cut).join(' ')] : [row.name];
    return `<g><title>${escapeHTML(row.name)}: ${fmt(row.footprint)} MiB${host ? `, host ${fmt(row.hostFootprint)}` : ''}</title>
<rect class="window" x="${x0.toFixed(1)}" y="${y(mean).toFixed(1)}" width="${w.toFixed(1)}" height="${(y(host) - y(mean)).toFixed(1)}"/>${
  host ? `<rect class="host" x="${x0.toFixed(1)}" y="${y(host).toFixed(1)}" width="${w.toFixed(1)}" height="${(base - y(host)).toFixed(1)}"/>` : ''}
<path class="err" d="M${center - 7} ${y(mean + sd).toFixed(1)}h14M${center - 7} ${y(mean - sd).toFixed(1)}h14M${center} ${y(mean + sd).toFixed(1)}V${y(mean - sd).toFixed(1)}"/>
${text(center, y(mean + sd) - 6, mean.toFixed(0), 'bold', 'middle')}${name.map((line, n) => text(center, base + 18 + n * 15, line, 'muted', 'middle')).join('')}</g>`;
  }).join('');
  return `${svgOpen(width, height, 'Memory footprint per client')}${text(20, 24, 'Footprint at five seconds, MiB (mean of ten launches)', 'title')}
${legend([[box('window'), 'app / UI process tree'], [box('host'), 'separate host process tree'],
    [(lx, ly) => `<path class="err" d="M${lx} ${ly}h14M${lx} ${ly + 12}h14M${lx + 7} ${ly}v12"/>`, '±1 sample std dev of the total']], 20, 48)}
${grid}${bars}<line class="rule" x1="${left}" x2="${right}" y1="${base}" y2="${base}"/></svg>`;
}

const figures = {startup: startupSVG(), footprint: footprintSVG()};
const figurePath = name => out.replace(/(\.html)?$/, `-${name}.svg`).replace('benchmark-report-', 'benchmark-');
for (const [name, svg] of Object.entries(figures)) writeFileSync(figurePath(name), svg + '\n');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(title)}</title>
<style>
:root{--bg:#fff;--fg:#1c1c1e;--muted:#6b6b70;--line:#d9d9de}
@media(prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececee;--muted:#9a9aa1;--line:#333338}}
body{margin:0;padding:24px 16px 48px;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1200px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 20px}
figure{margin:0 0 24px}figure svg{display:block;width:100%;height:auto}
.details{border-collapse:collapse;font-size:12px;width:100%}.details th,.details td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}a{color:inherit}
.doc{margin-top:32px;border-top:1px solid var(--line)}.doc h2{font-size:18px;margin:24px 0 6px}.doc p,.doc li{font-size:13px;color:var(--muted)}.doc table{border-collapse:collapse;font-size:12px}.doc th,.doc td{border:1px solid var(--line);padding:3px 8px;text-align:left}code{font-size:12px}
.notes{margin-top:28px;color:var(--muted);font-size:13px}.notes li{margin:4px 0}
</style></head><body><main>
<h1>${escapeHTML(title)}</h1>
${intro.map(blockHTML).join('\n')}
<p class="sub">Figures show means from the result files; all descriptions are copied from BENCHMARK.md. Generated ${new Date().toISOString()}.</p>
<figure>${figures.startup}</figure>
<figure>${figures.footprint}</figure>
<table class="details"><thead><tr><th>Client</th><th>Stack · host / workload</th><th>Footprint</th><th>Source</th></tr></thead><tbody>${rows.map(row =>
  `<tr><td>${escapeHTML(row.name)}</td><td>${row.note}</td><td>${row.footprint ? `${fmt(row.footprint)} MiB${row.hostFootprint ? ` (host ${fmt(row.hostFootprint)})` : ''}` : '—'}</td><td>${escapeHTML(row.source)}</td></tr>`).join('')}</tbody></table>
<ul class="notes">
<li>Segments on each client's bar run between consecutive milestones in time order; each is coloured by the milestone it ends at. Milestones are independent measurements, so their order can differ per client.</li>
<li>A “host” lane is a separate process running in parallel with the UI. RN starts host and UI together. Embedded hosts have no separate timer; upstream’s dashed lane is only an upper bound: its window is created after the host is listening, so host boot ends no later than first window. The gate chain under it is read from the code (<code>apps/desktop/src/index.ts</code>, <code>packages/server/src/host/boot.ts</code>), and its stage durations are not measured.</li>
</ul>
<section class="doc">${blocks.slice(tableAt + 1).map(blockHTML).join('\n')}</section></main></body></html>
`;
writeFileSync(out, html);

const pad = (value, width) => String(value).padEnd(width);
console.log(`${pad('client', 34)}${pad('host ready', 14)}${pad('first window', 14)}footprint MiB`);
for (const row of rows) {
  const milestone = key => row.milestones.find(m => m.key === key);
  console.log(`${pad(row.name, 34)}${pad(fmt(row.host), 14)}${pad(fmt(milestone('window')), 14)}${fmt(row.footprint)}`);
}
console.log(`\nWrote ${out}, ${Object.keys(figures).map(figurePath).join(', ')}`);
