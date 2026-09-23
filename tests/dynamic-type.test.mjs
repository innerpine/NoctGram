import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const compiled = await build({
  entryPoints: ['lib/dynamic-type-bootstrap.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { DYNAMIC_TYPE_BOOTSTRAP } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

// Runs the inline script against a minimal document; returns the root font size it set.
function rootSize({ apple = true, touch = 5, body = 17 } = {}) {
  const root = { style: {}, appendChild() {} };
  runInNewContext(DYNAMIC_TYPE_BOOTSTRAP, {
    CSS: { supports: (property) => apple && property === 'font' },
    navigator: { maxTouchPoints: touch },
    document: {
      documentElement: root,
      createElement: () => ({ style: {}, remove() {} }),
    },
    getComputedStyle: (element) => ({
      fontSize: element.style.font === '-apple-system-body' ? body + 'px' : '',
    }),
  });
  return root.style.fontSize;
}

void test('iOS text size scales the rem base and the default keeps 16px', () => {
  assert.equal(rootSize(), '16px');
  assert.equal(parseFloat(rootSize({ body: 14 })).toFixed(2), '13.18');
  assert.equal(parseFloat(rootSize({ body: 19 })).toFixed(2), '17.88');
  assert.equal(
    rootSize({ body: 53 }),
    rootSize({ body: 23 }),
    'Accessibility sizes stop at xxxLarge',
  );
});

void test('Android, desktop and macOS Safari keep the browser default', () => {
  assert.equal(rootSize({ apple: false }), undefined);
  assert.equal(rootSize({ touch: 0, body: 13 }), undefined);
  assert.doesNotThrow(() => runInNewContext(DYNAMIC_TYPE_BOOTSTRAP, {}));
});
