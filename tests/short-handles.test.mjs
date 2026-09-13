import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const parse = (path) =>
  ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
function find(source, predicate) {
  let result;
  function visit(node) {
    if (predicate(node)) result = node;
    else ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(result);
  return result.getText(source);
}
const features = parse('lib/social-features.ts'),
  server = parse('lib/server.ts');
const handle = find(
  features,
  (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'handle',
);
const clean = find(
  server,
  (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'clean',
).replace(/^export /, '');
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const compiled = ts.transpileModule(
  clean + '\n' + handle + '\nglobalThis.validate=handle;',
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
void test('only already assigned short handles survive a profile edit', () => {
  const env = { ApiError };
  runInNewContext(compiled, env);
  assert.equal(env.validate('@EZ', new Set(['ez'])), 'ez');
  assert.equal(env.validate('abc', new Set(['abc'])), 'abc');
  assert.equal(env.validate('invoker'), 'invoker');
  for (const [name, assigned] of [
    ['ez', undefined],
    ['ez', new Set(['ab'])],
    ['ab', new Set(['ez'])],
    ['a', new Set(['a'])],
    ['a-b', new Set(['a-b'])],
  ])
    assert.throws(
      () => env.validate(name, assigned),
      (e) => e.status === 400,
    );
});

const route = parse('app/api/social/route.ts');
const branch = find(
  route,
  (n) =>
    ts.isIfStatement(n) &&
    n.expression.getText(route) === "action === 'profile'" &&
    n.thenStatement.getText(route).includes("s.has('ref')"),
);
const lookup = ts.transpileModule(
  'globalThis.lookup=async()=>{' + branch + '};',
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
void test('profile URLs and mentions resolve a granted alias to its existing owner', async () => {
  const env = {
    ApiError,
    Response,
    action: 'profile',
    me: 'viewer',
    s: new URLSearchParams(),
    profile: async (id) => {
      if (id !== 'local_seedy') throw new ApiError(404, 'Missing');
      return { id, handle: 'invoker' };
    },
    d: {
      prepare(sql) {
        assert.equal(sql, 'SELECT userId FROM handles WHERE handle=?');
        return {
          bind(handle) {
            return {
              first: async () =>
                ['ez', 'invoker'].includes(handle)
                  ? { userId: 'local_seedy' }
                  : null,
            };
          },
        };
      },
    },
  };
  runInNewContext(lookup, env);
  for (const params of [
    { ref: 'ez' },
    { handle: '@EZ' },
    { ref: 'invoker' },
    { ref: 'local_seedy' },
    { id: 'local_seedy' },
  ]) {
    env.s = new URLSearchParams(params);
    const result = await (await env.lookup()).json();
    assert.deepEqual(result, { id: 'local_seedy', handle: 'invoker' });
  }
  env.s = new URLSearchParams({ handle: 'ab' });
  await assert.rejects(env.lookup(), (e) => e.status === 404);
});
