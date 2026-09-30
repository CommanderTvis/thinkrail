import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Sums phys_footprint (what Activity Monitor calls "Memory"), which counts compressed and
// swapped dirty pages and, unlike RSS, ignores clean file-backed pages.
export function footprintMiB(pids) {
  if (!pids.length) return 0;
  const dir = mkdtempSync(join(tmpdir(), 'footprint-'));
  const file = join(dir, 'footprint.json');
  try {
    execFileSync('footprint', ['-j', file, '--noCategories', ...pids.map(String)], {stdio: 'ignore'});
    const {processes} = JSON.parse(readFileSync(file, 'utf8'));
    const missing = pids.filter(pid => !processes.some(row => row.pid === pid));
    if (missing.length) throw new Error(`footprint returned no data for pids ${missing.join(', ')}`);
    return processes.reduce((sum, row) => sum + row.footprint, 0) / 1024 ** 2;
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}
