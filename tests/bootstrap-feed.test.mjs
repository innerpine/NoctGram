import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile(
  'route.ts',
  readFileSync('app/api/social/route.ts', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
let branch;
function visit(node) {
  if (
    ts.isIfStatement(node) &&
    node.expression.getText(source) === "action === 'bootstrap'"
  )
    branch = node.getText(source);
  else ts.forEachChild(node, visit);
}
visit(source);
assert.ok(branch);
const compiled = ts.transpileModule(
  'globalThis.bootstrap = async () => {' + branch + '};',
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

await test('bootstrap omits the global feed when restoring another section, retaining account data', async () => {
  for (const query of [
    'feed=0',
    'feed=0&mode=following',
    '',
    'feed=1',
    'feed=1&mode=following',
    'mode=invalid',
  ]) {
    const params = new URLSearchParams(query),
      calls = [];
    const context = {
      action: 'bootstrap',
      s: params,
      me: 'alice',
      Response,
      profile: async (id, viewer) => {
        assert.equal(id, 'alice');
        assert.equal(viewer, 'alice');
        return { id, handle: 'alice' };
      },
      feed: async (...args) => {
        calls.push(args);
        return [{ id: 'real-post' }];
      },
      appearanceColumns: () => 'u.avatar',
      visibleAccount: () => '1',
      personalVisibility: () => '1',
      d: {
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: [{ id: 'bob' }] }) }),
        }),
      },
    };
    runInNewContext(compiled, context);
    const data = await (await context.bootstrap()).json();
    assert.equal(data.me.id, 'alice');
    assert.deepEqual(data.people, [{ id: 'bob' }]);
    if (params.get('feed') === '0') {
      assert.deepEqual(data.posts, []);
      assert.equal(
        calls.length,
        0,
        'Profile/chat reload must not query the feed',
      );
    } else {
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0][1],
        params.get('mode') === 'following' ? 'following' : 'all',
      );
      assert.deepEqual(data.posts, [{ id: 'real-post' }]);
    }
  }
});
