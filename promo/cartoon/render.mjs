// Покадровый рендер мультфильма в видео через Chromium (Playwright) и ffmpeg.
//
//   node promo/cartoon/render.mjs --out cartoon.mp4 [--audio music.wav] [--from 0 --to 62]
//   node promo/cartoon/render.mjs --stills 3,12.5,40 --dir ./frames   # отдельные кадры в PNG
//
// Переменные окружения: FFMPEG — путь к ffmpeg (по умолчанию из PATH),
// PLAYWRIGHT_MODULE — путь к пакету playwright, если он установлен глобально.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const here = path.dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const ffmpeg = process.env.FFMPEG || 'ffmpeg';

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
await page.goto(pathToFileURL(path.join(here, 'index.html')).href + '?render=1');
await page.evaluate(() => window.cartoonReady);
const { FPS, DURATION } = await page.evaluate(() => ({ FPS: window.cartoon.FPS, DURATION: window.cartoon.DURATION }));

const toBuffer = url => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

if (args.stills) {
  const dir = path.resolve(args.dir || '.');
  fs.mkdirSync(dir, { recursive: true });
  for (const t of String(args.stills).split(',').map(Number)) {
    const url = await page.evaluate(tt => window.renderToDataURL(tt, 'image/png'), t);
    fs.writeFileSync(path.join(dir, `still_${t.toFixed(2).padStart(6, '0')}.png`), toBuffer(url));
  }
} else {
  const from = Number(args.from ?? 0), to = Number(args.to ?? DURATION);
  const out = path.resolve(args.out || 'cartoon.mp4');
  const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
  if (args.audio) ffArgs.push('-ss', String(from), '-i', path.resolve(args.audio));
  ffArgs.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  if (args.audio) ffArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  ffArgs.push(out);
  const ff = spawn(ffmpeg, ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', c => (c ? rej(new Error('ffmpeg exited ' + c)) : res())));
  const total = Math.round((to - from) * FPS);
  for (let f = 0; f < total; f++) {
    const url = await page.evaluate(tt => window.renderToDataURL(tt, 'image/jpeg', 0.95), from + f / FPS);
    if (!ff.stdin.write(toBuffer(url))) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 96 === 0) process.stdout.write(`\r${f}/${total}`);
  }
  ff.stdin.end();
  await done;
  console.log(`\r${total}/${total} → ${out}`);
}
await browser.close();
