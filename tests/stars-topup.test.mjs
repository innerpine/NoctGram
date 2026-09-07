import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { observeTopups } from '../lib/stars-topup.ts';

test('existing credits establish a quiet baseline and repeated refreshes stay quiet', () => {
  const first = observeTopups(null, { topupCount: 7, topupTotal: 13000 });
  assert.equal(first.amount, 0);
  assert.equal(
    observeTopups(first.cursor, { topupCount: 7, topupTotal: 13000 }).amount,
    0,
  );
});

test('aggregates new top-ups, including credits outside the latest history page', () => {
  const credit = observeTopups(
    { count: 7, total: 13000 },
    { topupCount: 67, topupTotal: 43000 },
  );
  assert.equal(credit.amount, 30000);
  assert.equal(
    observeTopups(credit.cursor, { topupCount: 67, topupTotal: 43000 }).amount,
    0,
  );
});

test('stored per-account cursor works after reopening; reset totals do not celebrate', () => {
  const stored = JSON.parse(JSON.stringify({ count: 1, total: 100 }));
  assert.equal(
    observeTopups(stored, { topupCount: 2, topupTotal: 600 }).amount,
    500,
  );
  assert.equal(
    observeTopups(stored, { topupCount: 0, topupTotal: 0 }).amount,
    0,
  );
  assert.equal(
    observeTopups(stored, { topupCount: 1, topupTotal: 500 }).amount,
    0,
  );
});

test('actual wallet totals SQL separates top-ups from grants, spending, and other accounts', () => {
  const source = readFileSync(
    new URL('../lib/social-features.ts', import.meta.url),
    'utf8',
  );
  const sql = source.match(/"(SELECT [^"\r\n]+ AS topupCount[^"\r\n]+)"/)?.[1];
  assert.ok(sql);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      'CREATE TABLE star_transfers (sender TEXT,recipient TEXT,amount INTEGER,kind TEXT)',
    );
    const insert = db.prepare('INSERT INTO star_transfers VALUES (?,?,?,?)');
    for (const row of [
      [null, 'me', 10000, 'grant'],
      [null, 'me', 500, 'telegram_test'],
      [null, 'me', 1000, 'telegram_test'],
      [null, 'other', 10000, 'telegram_test'],
      ['other', 'me', 70, 'support'],
      ['me', 'other', 900, 'support'],
    ])
      insert.run(...row);
    const totals = db.prepare(sql).get('me', 'me', 'me', 'me', 'me', 'me');
    assert.deepEqual(
      { ...totals },
      { received: 70, sent: 900, topupCount: 2, topupTotal: 1500 },
    );
    const empty = db
      .prepare(sql)
      .get('empty', 'empty', 'empty', 'empty', 'empty', 'empty');
    assert.equal(empty.topupTotal, 0);
    assert.equal(empty.topupCount, 0);
  } finally {
    db.close();
  }
});
