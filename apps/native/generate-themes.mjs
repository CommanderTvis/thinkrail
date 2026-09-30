import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {THINKRAIL_SHIKI_THEME} from '../../apps/web/src/themes/shiki.ts';

const here = dirname(fileURLToPath(import.meta.url));
const bundled = join(here, '../../apps/web/src/themes/bundled');
const themes = ['dark', 'light', 'high-contrast-dark', 'high-contrast-light'].map(id => {
  const {label, appearance, contrast, colors, syntax} = JSON.parse(readFileSync(join(bundled, `${id}.theme.json`), 'utf8'));
  return {id, label, appearance, contrast, colors, syntax};
});
writeFileSync(join(here, 'src', 'theme-colors.json'), `${JSON.stringify(themes, null, 2)}\n`);
writeFileSync(join(here, 'src', 'shiki-theme.json'), `${JSON.stringify(THINKRAIL_SHIKI_THEME, null, 2)}\n`);
