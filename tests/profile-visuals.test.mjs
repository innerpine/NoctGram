import assert from 'node:assert/strict';
import { build } from 'esbuild';

const images = [],
  palettes = [];
let paletteReady;
globalThis.__profilePalette = (url) => {
  palettes.push(url);
  return new Promise((resolve) => {
    paletteReady = resolve;
  });
};
const oldImage = globalThis.Image;
globalThis.Image = class {
  constructor() {
    images.push(this);
  }
  decode() {
    return new Promise((resolve) => {
      this.decoded = resolve;
    });
  }
};
const { outputFiles } = await build({
  entryPoints: ['lib/profile-visuals.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'palette-boundary',
      setup(build) {
        build.onResolve({ filter: /^\.\/use-image-palette$/ }, ({ path }) => ({
          path,
          namespace: 'fixture',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents:
            'export const preloadImagePalette=url=>globalThis.__profilePalette(url);',
        }));
      },
    },
  ],
});
const { prepareProfileVisuals } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const background = (mode) =>
  JSON.stringify({ mode, first: '#aabbcc', second: '#112233', intensity: 30 });
const person = {
  premium: true,
  cover: '/banner',
  avatar: '/avatar',
  profileBackground: background('cover'),
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
try {
  let ready = false;
  const preparation = prepareProfileVisuals(person).then(() => {
    ready = true;
  });
  assert.deepEqual(
    images.map((image) => image.src),
    ['/banner', '/avatar'],
  );
  assert.deepEqual(palettes, ['/banner']);
  images.forEach((image) => image.onload());
  await flush();
  assert.equal(
    ready,
    false,
    'Network load alone does not mean the images are decoded',
  );
  images.forEach((image) => image.decoded());
  await flush();
  assert.equal(
    ready,
    false,
    'Do not reveal the fallback palette before sampling finishes',
  );
  paletteReady(['#aabbcc', '#112233']);
  await preparation;
  assert.equal(ready, true);
  for (const mode of ['theme', 'custom', 'none'])
    await prepareProfileVisuals({
      ...person,
      profileBackground: background(mode),
    });
  assert.equal(images.length, 2, 'Reopening reuses decoded images');
  assert.equal(
    palettes.length,
    1,
    'Only the cover background requires image sampling',
  );
  const failure = prepareProfileVisuals({
    ...person,
    cover: '/broken',
    avatar: '',
    profileBackground: background('theme'),
  });
  images.at(-1).onerror();
  await failure;
  assert.equal(
    images.at(-1).onerror,
    null,
    'A broken banner releases the loading state and handlers',
  );
  await prepareProfileVisuals({ premium: false, cover: '', avatar: '' });
} finally {
  globalThis.Image = oldImage;
  delete globalThis.__profilePalette;
}
console.log(
  'Profile visuals: decoded images and sampled palette before reveal, warm cache, theme/custom modes and failed image fallback passed.',
);
