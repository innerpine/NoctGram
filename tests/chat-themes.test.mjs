import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
for (const entry of journal.entries)
  sqlite.exec(await readFile(`drizzle/${entry.tag}.sql`, 'utf8'));
sqlite.exec(
  "INSERT INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',1),('carol','Carol',1)",
);
globalThis.__chatThemeDb = {
  prepare(sql) {
    let values = [];
    return {
      bind(...args) {
        values = args;
        return this;
      },
      async first() {
        return sqlite.prepare(sql).get(...values) || null;
      },
      async run() {
        return {
          meta: { changes: sqlite.prepare(sql).run(...values).changes },
        };
      },
    };
  },
};
try {
  const compiled = await build({
    entryPoints: ['lib/chat-theme-settings.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'theme-database',
        setup(build) {
          build.onResolve({ filter: /^\.\/(storage|server)$/ }, ({ path }) => ({
            path,
            namespace: 'fixture',
          }));
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents:
              "export const db=()=>globalThis.__chatThemeDb; export { ApiError } from './lib/api-error'; export const clean=value=>value;",
            resolveDir: fileURLToPath(new URL('..', import.meta.url)),
          }));
        },
      },
    ],
  });
  const { readChatTheme, saveChatTheme } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(compiled.outputFiles[0].text).toString('base64')
  );
  const save = (me, peer, scope, theme, extra = {}) =>
    saveChatTheme(me, { peer, scope, theme, ...extra });
  const effective = async (me, peer) => {
    const state = await readChatTheme(me, peer);
    return state.personal || state.shared;
  };
  assert.equal(await effective('alice', 'bob'), 'noct');
  await save('alice', 'bob', 'shared', 'aurora');
  assert.equal(
    await effective('bob', 'alice'),
    'aurora',
    'Shared theme is independent of participant ordering',
  );
  await save('bob', 'alice', 'personal', 'rose');
  await save('alice', 'bob', 'shared', 'ocean');
  assert.equal(
    await effective('bob', 'alice'),
    'rose',
    'Shared changes never replace the peer override',
  );
  assert.equal(await effective('alice', 'bob'), 'ocean');
  assert.equal(
    (await readChatTheme('alice', 'bob')).personal,
    null,
    'Other participant private selection is not exposed',
  );
  await save('bob', 'alice', 'personal', null);
  assert.equal(
    await effective('bob', 'alice'),
    'ocean',
    'Returning to shared uses its latest theme',
  );
  await save('alice', 'bob', 'personal', 'mist');
  await save('alice', 'bob', 'shared', 'amber');
  assert.equal(
    await effective('alice', 'bob'),
    'amber',
    'Choosing shared clears only the chooser override',
  );
  await Promise.all([
    save('alice', 'bob', 'personal', 'olive'),
    save('bob', 'alice', 'personal', 'dusk'),
  ]);
  assert.equal(await effective('alice', 'bob'), 'olive');
  assert.equal(
    await effective('bob', 'alice'),
    'dusk',
    'Concurrent overrides are separate columns',
  );
  await save('carol', 'bob', 'shared', 'mist', {
    firstId: 'alice',
    secondId: 'bob',
    owner: 'alice',
  });
  assert.equal(
    await effective('alice', 'bob'),
    'olive',
    'Client cannot choose another pair or owner',
  );
  assert.equal(
    (await readChatTheme('alice', 'carol')).revision,
    0,
    'Unrelated chats stay unchanged',
  );
  for (const data of [
    { scope: 'shared', theme: 'url(evil)' },
    { scope: 'shared', theme: null },
    { scope: 'bob', theme: 'rose' },
  ])
    await assert.rejects(
      saveChatTheme('alice', { peer: 'bob', ...data }),
      (e) => e.status === 400,
    );
  await assert.rejects(
    save('alice', 'alice', 'shared', 'noct'),
    (e) => e.status === 400,
  );
  await assert.rejects(
    save('alice', 'missing', 'shared', 'noct'),
    (e) => e.status === 403,
  );
  sqlite.exec(
    "INSERT INTO user_blocks(blocker,blocked,created) VALUES('bob','alice',1)",
  );
  await assert.rejects(
    save('alice', 'bob', 'shared', 'noct'),
    (e) => e.status === 403,
  );
  await save('alice', 'bob', 'personal', 'mist');
  assert.equal(
    await effective('alice', 'bob'),
    'mist',
    'A blocked chat can still be styled locally',
  );
  sqlite.exec(
    "DELETE FROM user_blocks; INSERT INTO user_privacy(userId,messagePolicy) VALUES('bob','nobody')",
  );
  await assert.rejects(
    save('alice', 'bob', 'shared', 'noct'),
    (e) => e.status === 403,
  );
  const changes = sqlite.prepare('SELECT total_changes() AS n').get().n;
  for (let i = 0; i < 10; i++) await readChatTheme('alice', 'bob');
  assert.equal(
    sqlite.prepare('SELECT total_changes() AS n').get().n,
    changes,
    'Polling does not write preferences',
  );
  assert.match(
    sqlite
      .prepare(
        'EXPLAIN QUERY PLAN SELECT * FROM chat_themes WHERE firstId=? AND secondId=?',
      )
      .get('alice', 'bob').detail,
    /INDEX/,
  );
  console.log(
    'Chat themes: shared/personal precedence, reset, concurrent accounts, chat isolation, validation, blocking/privacy and read-only polling passed with real SQLite.',
  );
} finally {
  delete globalThis.__chatThemeDb;
  sqlite.close();
}
