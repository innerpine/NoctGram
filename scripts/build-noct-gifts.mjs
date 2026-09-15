import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = path.join(root, 'noct-gifts');
const publicRoot = path.join(root, 'public');
const destination = path.join(publicRoot, 'drop');
const assetExtensions = new Set([
  '.png',
  '.svg',
  '.webp',
  '.json',
  '.js',
  '.txt',
]);

// Only this generated directory is replaced; never publish the mini-app server,
// tests, environment files or the rest of the repository as static content.
export function buildNoctGifts() {
  if (
    realpathSync(publicRoot) !== publicRoot ||
    path.resolve(destination) !== path.join(publicRoot, 'drop')
  )
    throw new Error('Unexpected public mini-app directory');
  if (existsSync(destination)) {
    if (lstatSync(destination).isSymbolicLink())
      throw new Error('Mini-app output must not be a symlink');
    rmSync(destination, { recursive: true });
  }
  mkdirSync(destination);
  const copyAsset = (relative) => {
    const src = path.join(source, relative);
    const target = path.join(destination, relative);
    const info = lstatSync(src);
    if (info.isSymbolicLink())
      throw new Error('Mini-app assets must not be symlinks');
    if (info.isDirectory()) {
      mkdirSync(target, { recursive: true });
      for (const file of readdirSync(src)) copyAsset(path.join(relative, file));
    } else if (info.isFile() && assetExtensions.has(path.extname(relative))) {
      copyFileSync(src, target);
    }
  };
  for (const file of [
    'motion.css',
    'effects.js',
    'account-bridge.js',
    'support.js',
    'Lottie-LICENSE.md',
  ])
    copyFileSync(path.join(source, file), path.join(destination, file));
  copyAsset('assets');
  const html = readFileSync(
    path.join(source, 'Noct Gifts App.dc.html'),
    'utf8',
  );
  if (!html.includes('</head>'))
    throw new Error('Mini-app entrypoint is missing its head');
  const entry = html.replace(
    '</head>',
    '<meta name="robots" content="noindex, nofollow">\n<script>window.NoctGiftsConfig={directAssets:true};</script>\n</head>',
  );
  writeFileSync(path.join(destination, 'index.html'), entry);
  writeFileSync(path.join(destination, 'Noct Gifts App.dc.html'), entry);
  return destination;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  buildNoctGifts();
  console.log(
    'Noct Gifts prepared for /drop/ with local UI libraries and the main NoctGram API.',
  );
}
