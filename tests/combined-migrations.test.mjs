import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const directory = new URL('../drizzle/', import.meta.url);
const json = async (path) =>
  JSON.parse(await readFile(new URL(path, directory), 'utf8'));
const journal = (await json('meta/_journal.json')).entries;
const scripts = new Map(
  await Promise.all(
    journal.map(async (e) => [
      e.tag,
      await readFile(new URL(e.tag + '.sql', directory), 'utf8'),
    ]),
  ),
);
assert.equal(
  scripts.size,
  journal.length,
  'Every original migration has a unique tag',
);
assert.deepEqual(
  [...scripts.keys()].sort((a, b) => a.localeCompare(b)),
  (await readdir(directory))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.slice(0, -4))
    .sort((a, b) => a.localeCompare(b)),
);
let previousId = '00000000-0000-0000-0000-000000000000';
for (const [index, entry] of journal.entries()) {
  assert.equal(entry.idx, index);
  if (index) assert.ok(entry.when > journal[index - 1].when);
  const snapshot = await json(
    'meta/' + String(index).padStart(4, '0') + '_snapshot.json',
  );
  assert.equal(snapshot.prevId, previousId);
  previousId = snapshot.id;
}
const music = [
  '0007_perfect_radioactive_man',
  '0008_polite_adam_destine',
  '0009_ambiguous_polaris',
];
const markdev = [
  '0007_organic_slipstream',
  '0008_spotty_madame_web',
  '0009_dazzling_eternity',
  '0010_past_chat',
];
const baseline = journal.slice(0, 7).map((e) => e.tag);
const schema = (db) =>
  db
    .prepare(
      "SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all();
const fresh = new DatabaseSync(':memory:');
for (const sql of scripts.values()) fresh.exec(sql);
const expected = schema(fresh);
const snapshot = await json(
  'meta/' + String(journal.length - 1).padStart(4, '0') + '_snapshot.json',
);
for (const [table, definition] of Object.entries(snapshot.tables)) {
  assert.match(table, /^[a-z_]+$/);
  assert.deepEqual(
    fresh
      .prepare(`PRAGMA table_info('${table}')`)
      .all()
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b)),
    Object.keys(definition.columns).sort((a, b) => a.localeCompare(b)),
  );
}
for (const { label, applied } of [
  { label: 'music', applied: music },
  { label: 'markdev', applied: markdev },
]) {
  const db = new DatabaseSync(':memory:');
  try {
    for (const tag of [...baseline, ...applied]) db.exec(scripts.get(tag));
    db.exec(
      "INSERT INTO users(id,name,created) VALUES('merge_fixture','Existing account',1)",
    );
    if (label === 'music')
      db.exec(
        "INSERT INTO music_tracks(id,url,kind,provider,title,artist,authorUrl,created) VALUES('merge_track','https://soundcloud.com/merge/test','track','soundcloud','Saved song','Artist','https://soundcloud.com/merge',1); INSERT INTO music_library(userId,trackId,created) VALUES('merge_fixture','merge_track',1)",
      );
    else
      db.exec(
        "INSERT INTO profile_appearance(userId,theme,chromeFlow,updated) VALUES('merge_fixture','rose',1,1)",
      );
    const completed = new Set([...baseline, ...applied]);
    for (const [tag, sql] of scripts) if (!completed.has(tag)) db.exec(sql);
    assert.deepEqual(
      schema(db),
      expected,
      label + ' converges to the complete schema',
    );
    assert.equal(
      db.prepare("SELECT name FROM users WHERE id='merge_fixture'").get().name,
      'Existing account',
    );
    if (label === 'music')
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM music_library WHERE userId='merge_fixture'",
          )
          .get().n,
        1,
      );
    else
      assert.equal(
        db
          .prepare(
            "SELECT theme FROM profile_appearance WHERE userId='merge_fixture'",
          )
          .get().theme,
        'rose',
      );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
}
const alphabetic = new DatabaseSync(':memory:');
for (const tag of [...scripts.keys()].sort((a, b) => a.localeCompare(b)))
  alphabetic.exec(scripts.get(tag));
assert.deepEqual(
  schema(alphabetic),
  expected,
  'The documented filename ordering also creates the same schema',
);
alphabetic.close();
fresh.close();
console.log(
  'Combined migrations: intact journal, snapshots, fresh install, and both existing branches upgrade to one schema without losing account, library or profile data.',
);
