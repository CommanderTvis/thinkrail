import {cpSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const anchor = '  mainWindow.webview.on("dom-ready", () => {\n    if (ready)\n      return;\n    ready = true;\n';
const webScript = `(function(url) {
  let sent = false;
  const check = () => {
    if (sent || !document.querySelector('[data-testid="workspace-workbench"]')) return;
    sent = true;
    observer.disconnect();
    fetch(url + '?at=' + Date.now(), {mode: 'no-cors', cache: 'no-store'}).catch(() => {});
  };
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, {childList: true, subtree: true});
  check();
})`;
const injection = `    const workspaceProbeURL = process.env.THINKRAIL_DESKTOP_WORKSPACE_PROBE_URL;
    if (workspaceProbeURL) mainWindow.webview.executeJavascript(${JSON.stringify(webScript)} + "(" + JSON.stringify(workspaceProbeURL) + ")");
`;

export function prepareDesktopProbe(source, target) {
  cpSync(source, target, {recursive: true});
  const entry = join(target, 'Contents/Resources/app/bun/index.js');
  const content = readFileSync(entry, 'utf8');
  if (content.split(anchor).length !== 2) throw new Error(`Desktop entry has no unique DOM-ready anchor: ${source}`);
  writeFileSync(entry, content.replace(anchor, anchor + injection));
  return target;
}
