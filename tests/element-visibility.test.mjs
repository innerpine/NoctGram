import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
await test('hundreds of decorations share one observer, pause with visibility and clean up every subscription', async () => {
  const saved = {
    document: globalThis.document,
    IntersectionObserver: globalThis.IntersectionObserver,
  };
  let instances = 0,
    disconnected = 0,
    handler;
  const observed = new Set(),
    listeners = new Set();
  globalThis.document = {
    hidden: false,
    addEventListener: (event, fn) => listeners.add(fn),
    removeEventListener: (event, fn) => listeners.delete(fn),
  };
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      instances++;
      handler = callback;
    }
    observe(e) {
      observed.add(e);
    }
    unobserve(e) {
      observed.delete(e);
    }
    disconnect() {
      disconnected++;
    }
  };
  try {
    const code = ts.transpileModule(
      await readFile('lib/element-visibility.ts', 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.ESNext } },
    ).outputText;
    const { observeElementVisibility: watch, observePostVisibility } =
      await import(
        'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
      );
    const elements = Array.from({ length: 200 }, () => ({})),
      values = new Map();
    const stops = elements.map((e) => watch(e, (v) => values.set(e, v)));
    assert.equal(instances, 1);
    assert.equal(listeners.size, 1);
    assert.equal(observed.size, 200);
    const extra = [];
    const stopExtra = watch(elements[0], (v) => extra.push(v));
    assert.equal(observed.size, 200);
    handler(elements.map((e) => ({ target: e, isIntersecting: true })));
    assert.ok([...values.values()].every(Boolean));
    document.hidden = true;
    listeners.forEach((fn) => fn());
    assert.ok([...values.values()].every((v) => !v));
    handler([{ target: elements[0], isIntersecting: false }]);
    document.hidden = false;
    listeners.forEach((fn) => fn());
    assert.equal(values.get(elements[0]), false);
    assert.equal(values.get(elements[1]), true);
    stops.forEach((stop) => stop());
    assert.equal(observed.size, 1);
    assert.equal(disconnected, 0);
    stopExtra();
    assert.equal(observed.size, 0);
    assert.equal(listeners.size, 0);
    assert.equal(disconnected, 1);
    assert.deepEqual(extra, [false, true, false, false, false]);
    const seen = [];
    const stopPost = observePostVisibility(elements[0], (visible) =>
      seen.push(visible),
    );
    handler([
      { target: elements[0], isIntersecting: true, intersectionRatio: 0.49 },
    ]);
    handler([
      { target: elements[0], isIntersecting: true, intersectionRatio: 0.5 },
    ]);
    document.hidden = true;
    listeners.forEach((fn) => fn());
    assert.deepEqual(seen, [false, false, true, false]);
    stopPost();
    assert.equal(listeners.size, 0);
  } finally {
    Object.assign(globalThis, saved);
  }
});
