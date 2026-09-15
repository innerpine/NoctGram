import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { buildNoctGifts } from '../scripts/build-noct-gifts.mjs';

void test('permanent mini-app publishes only public files and boots its pinned UI libraries locally', () => {
  const output = buildNoctGifts();
  const list = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const file = path.join(dir, name);
      return statSync(file).isDirectory()
        ? list(file)
        : [path.relative(output, file).replaceAll('\\', '/')];
    });
  const files = list(output);
  assert(files.length > 20);
  for (const file of files) {
    assert(!/(?:^|\/)(?:\.|server|.*\.test\.)/.test(file), file);
    assert(!file.endsWith('.mjs'), file);
  }
  const html = readFileSync(path.join(output, 'index.html'), 'utf8');
  assert(html.includes('window.NoctGiftsConfig={directAssets:true}'));
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    scripts.filter((src) => src.startsWith('https:')),
    ['https://telegram.org/js/telegram-web-app.js'],
  );
  const context = vm.createContext({ console });
  context.self = context;
  for (const [name, file] of [
    ['REACT', 'react.production.min.js'],
    ['REACT_DOM', 'react-dom.production.min.js'],
  ]) {
    const source = readFileSync(path.join(output, 'assets/vendor', file));
    const runtime = readFileSync('noct-gifts/support.js', 'utf8');
    const sri = runtime.match(
      new RegExp('var ' + name + '_SRI = "([^"]+)"'),
    )[1];
    assert.equal(
      'sha384-' + createHash('sha384').update(source).digest('base64'),
      sri,
    );
    vm.runInContext(source.toString(), context);
    assert(
      scripts.indexOf('./assets/vendor/' + file) <
        scripts.indexOf('./support.js'),
    );
  }
  assert.equal(context.React.version, '18.3.1');
  assert.equal(typeof context.ReactDOM.createRoot, 'function');
  for (const src of scripts.filter((src) => src.startsWith('./')))
    assert(files.includes(src.slice(2)), src);
});
