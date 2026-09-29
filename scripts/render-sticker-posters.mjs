// Renders a static WebP poster for every built-in Lottie sticker and custom
// emoji, so pickers can show a grid while only a few animations play.
// Needs Playwright with Chromium:
//   NODE_PATH=<global node_modules> node scripts/render-sticker-posters.mjs
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(
  await readFile(new URL('lib/sticker-catalog.json', root), 'utf8'),
);
const SIZE = 256;
const files = [
  ...new Set(catalog.packs.flatMap((pack) => pack.items.map((i) => i.path))),
];
await mkdir(new URL('public/assets/stickers/posters/', root), {
  recursive: true,
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage();
await page.setContent(
  `<canvas id="poster" width="${SIZE}" height="${SIZE}"></canvas>`,
);
await page.addScriptTag({
  path: new URL(
    'node_modules/lottie-web/build/player/lottie_light_canvas.min.js',
    root,
  ).pathname,
});
for (const path of files) {
  const data = JSON.parse(
    await readFile(new URL('public' + path, root), 'utf8'),
  );
  // The earliest frame that shows most of the picture: some animations
  // start from an empty canvas or draw their subject in.
  const url = await page.evaluate(async (animationData) => {
    const canvas = document.getElementById('poster');
    const context = canvas.getContext('2d');
    const animation = globalThis.lottie.loadAnimation({
      renderer: 'canvas',
      loop: false,
      autoplay: false,
      animationData,
      rendererSettings: {
        context,
        clearCanvas: true,
        preserveAspectRatio: 'xMidYMid meet',
      },
    });
    await new Promise((resolve) => {
      if (animation.isLoaded) resolve();
      else animation.addEventListener('DOMLoaded', resolve);
    });
    animation.resize();
    const coverage = () => {
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let filled = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 24) filled++;
      return filled / (canvas.width * canvas.height);
    };
    const frames = [0, 0.2, 0.4, 0.6, 0.8, 0.999].map((share) =>
      Math.floor((animation.totalFrames - 1) * share),
    );
    const covered = frames.map((frame) => {
      animation.goToAndStop(frame, true);
      return coverage();
    });
    const best = Math.max(...covered);
    const chosen = frames[covered.findIndex((value) => value >= best * 0.75)];
    animation.goToAndStop(chosen, true);
    const result = canvas.toDataURL('image/webp', 0.9);
    animation.destroy();
    return result;
  }, data);
  const name = path
    .split('/')
    .pop()
    .replace(/\.json$/, '.webp');
  const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  await writeFile(
    new URL('public/assets/stickers/posters/' + name, root),
    bytes,
  );
  console.log(name, bytes.length);
}
await browser.close();
