import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToReadableStream } from 'react-dom/server';

const require = createRequire(import.meta.url);
let code = ts.transpileModule(
  await readFile('app/deferred-panel.tsx', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
for (const name of ['react', 'react/jsx-runtime']) {
  const path = pathToFileURL(require.resolve(name)).href;
  code = code
    .replaceAll(`from '${name}'`, `from '${path}'`)
    .replaceAll(`from "${name}"`, `from '${path}'`);
}
const { deferredPanel } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
await test('closed panels do not load; concurrent opens share the module and preserve different props', async () => {
  let calls = 0,
    finish;
  const Panel = deferredPanel(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  assert.equal(calls, 0);
  const firstReady = renderToReadableStream(
    React.createElement(Panel, { title: 'First' }),
  );
  const secondReady = renderToReadableStream(
    React.createElement(Panel, { title: 'Second' }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  finish({ default: (props) => React.createElement('p', {}, props.title) });
  const [first, second] = await Promise.all([firstReady, secondReady]);
  await Promise.all([first.allReady, second.allReady]);
  assert.match(await new Response(first).text(), /<p>First<\/p>/);
  assert.match(await new Response(second).text(), /<p>Second<\/p>/);
  await Panel.preload();
  assert.equal(calls, 1);
});
await test('failed module downloads can be retried instead of caching the failure permanently', async () => {
  let attempts = 0;
  const Panel = deferredPanel(async () => {
    if (++attempts === 1) throw new Error('Offline');
    return { default: () => React.createElement('p', {}, 'Recovered') };
  });
  await assert.rejects(Panel.preload(), /Offline/);
  await Panel.preload();
  const stream = await renderToReadableStream(React.createElement(Panel));
  await stream.allReady;
  assert.match(await new Response(stream).text(), /Recovered/);
  assert.equal(attempts, 2);
});
