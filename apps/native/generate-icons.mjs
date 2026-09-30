import {createRequire} from 'node:module';
import {readFileSync, readdirSync, mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const react = require(join(root, 'apps/web/node_modules/react'));
const {renderToStaticMarkup} = require(join(root, 'apps/web/node_modules/react-dom/server'));
const remix = require(join(root, 'apps/web/node_modules/@remixicon/react'));
const sharpDir = readdirSync(join(root, 'node_modules/.bun')).find(name => name.startsWith('sharp@'));
if (!sharpDir) throw new Error('Root workspace sharp dependency is missing');
const sharp = require(join(root, 'node_modules/.bun', sharpDir, 'node_modules/sharp'));
const assets = join(root, 'apps/native/src/assets/icons');
mkdirSync(assets, {recursive: true});
const names = {
  add: 'RiAddLine', arrowDown: 'RiArrowDownSLine', arrowRight: 'RiArrowRightSLine', arrowUp: 'RiArrowUpLine',
  alertCaution: 'RiAlarmWarningLine', alertImportant: 'RiErrorWarningLine', alertNote: 'RiInformationLine',
  alertTip: 'RiLightbulbLine', alertWarning: 'RiAlertLine',
  book: 'RiBookOpenLine', bookFill: 'RiBookOpenFill', box: 'RiBox3Line', brain: 'RiBrainLine',
  chat: 'RiChat2Line', chatNew: 'RiChatNewLine', check: 'RiCheckLine', circle: 'RiCircleLine',
  circleFill: 'RiCircleFill', close: 'RiCloseLine', coins: 'RiCoinsLine', diff: 'RiGitPullRequestLine', discuss: 'RiDiscussLine',
  copy: 'RiFileCopyLine', externalLink: 'RiExternalLinkLine', more: 'RiMore2Line', pencil: 'RiPencilLine', trash: 'RiDeleteBin6Line',
  compaction: 'RiContractUpDownLine', compactionSpin: 'RiLoopRightLine', stop: 'RiStopLine', search: 'RiSearchLine',
  feedback: 'RiFeedbackLine', file: 'RiFileLine', fileAdd: 'RiFileAddLine', fileFill: 'RiFileFill', fileText: 'RiFileTextLine', folder: 'RiFolderLine', fullscreen: 'RiFullscreenLine',
  folderFill: 'RiFolderFill', folderOpen: 'RiFolderOpenLine', folderTab: 'RiFolder2Fill',
  gitBranch: 'RiGitBranchLine', globe: 'RiGlobalLine', home: 'RiHome2Line', homeFill: 'RiHome2Fill',
  key: 'RiKeyLine', layout: 'RiLayoutTop2Line', layoutGrid: 'RiLayoutGridLine', list: 'RiListCheck3', loader: 'RiLoader4Line', lock: 'RiLockLine', login: 'RiLoginBoxLine', logout: 'RiLogoutBoxLine', network: 'RiNetworkLine',
  palette: 'RiPaletteLine', robot: 'RiRobot2Line', bard: 'RiBardLine', play: 'RiPlayLine', tools: 'RiToolsLine', scan: 'RiSearchEyeLine', send: 'RiSendPlane2Line',
  refresh: 'RiRefreshLine', settings: 'RiSettings3Line', shield: 'RiShieldCheckLine', sparkle: 'RiSparkling2Line', stack: 'RiStackLine',
  sliders: 'RiEqualizerLine', terminal: 'RiTerminalBoxLine', textWrap: 'RiTextWrap',
};
for (const [name, symbol] of Object.entries(names)) {
  const svg = renderToStaticMarkup(react.createElement(remix[symbol], {color: '#000000', size: 72}));
  await sharp(Buffer.from(svg)).png().toFile(join(assets, `${name}.png`));
}
let custom = readFileSync(join(root, 'apps/web/public/custom-icons/file-diff-line.svg'), 'utf8');
custom = custom.replace('currentColor', '#000000');
await sharp(Buffer.from(custom)).resize(72, 72).png().toFile(join(assets, 'fileDiff.png'));
const brandSource = readFileSync(join(root, 'apps/web/src/shell/BrandLogo.tsx'), 'utf8');
const brandPath = brandSource.match(/<path[\s\S]*?\sd="([^"]+)"/)?.[1];
if (!brandPath) throw new Error('ThinkRail brand path missing');
const brandSvg = color => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -53.5 557 557"><path fill="${color}" d="${brandPath}"/></svg>`;
await sharp(Buffer.from(brandSvg('#000000'))).resize(96, 96).png().toFile(join(assets, 'brand.png'));
const iconDir = join(root, 'apps/native/macos/ThinkRailNative-macOS/Assets.xcassets/AppIcon.appiconset');
const background = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="0" y="0" width="1024" height="1024" rx="220" fill="#18181b"/></svg>');
const mark = await sharp(Buffer.from(brandSvg('#8dff4f'))).resize(690, 690).png().toBuffer();
const icon = await sharp(background).composite([{input: mark, left: 167, top: 167}]).png().toBuffer();
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  await sharp(icon).resize(size, size).png().toFile(join(iconDir, `icon-${size}.png`));
}
const images = [];
for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) images.push({idiom: 'mac', scale: `${scale}x`, size: `${size}x${size}`, filename: `icon-${size * scale}.png`});
writeFileSync(join(iconDir, 'Contents.json'), JSON.stringify({images, info: {author: 'xcode', version: 1}}, null, 2) + '\n');
console.log(`${Object.keys(names).length + 2} UI assets and AppIcon generated`);
