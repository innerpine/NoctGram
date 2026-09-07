import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
// Transpile this dependency-free URL boundary without adding a test runner.
const source = await readFile(
  new URL('../lib/music-links.ts', import.meta.url),
  'utf8',
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { parseMusicLink, findMusicLink, formatMusicTime } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);
assert.deepEqual(
  parseMusicLink(
    'https://www.soundcloud.com/forss/flickermood?utm_source=test',
  ),
  {
    provider: 'soundcloud',
    kind: 'track',
    url: 'https://soundcloud.com/forss/flickermood',
  },
);
assert.equal(
  parseMusicLink('https://soundcloud.com/artist/sets/playlist').kind,
  'playlist',
);
for (const url of [
  'http://soundcloud.com/a/b',
  'https://soundcloud.com.evil.test/a/b',
  'https://soundcloud.com@evil.test/a/b',
  'https://soundcloud.com/a/b?secret_token=s-private',
  'https://soundcloud.com/a/b/s-private',
  'https://soundcloud.com/a/likes',
  'https://soundcloud.com/search/tracks',
  'https://127.0.0.1/a/b',
  'https://soundcloud.com/a/%2e%2e/admin',
  'https://soundcloud.com/a/sets',
  'https://soundcloud.com/a',
  'javascript:alert(1)',
])
  assert.equal(parseMusicLink(url), null, url);
assert.equal(
  findMusicLink('Слушай: https://soundcloud.com/forss/flickermood.').url,
  'https://soundcloud.com/forss/flickermood',
);
assert.equal(formatMusicTime(NaN), '0:00');
assert.equal(formatMusicTime(61000), '1:01');
console.log('Music URL boundary tests passed.');
