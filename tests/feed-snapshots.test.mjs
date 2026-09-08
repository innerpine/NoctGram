import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['lib/feed-snapshots.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { createFeedSnapshots, feedKey, sameSearch } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

void test('returning to feed and search reuses their own post objects and pagination', () => {
  const cache = createFeedSnapshots();
  cache.reset('me', 0);
  const feed = {
    key: feedKey('me', 'feed', 'all', ''),
    posts: [{ id: 'feed' }],
    hasMore: true,
  };
  const search = {
    key: feedKey('me', 'search', 'all', 'music'),
    posts: [{ id: 'result' }],
    hasMore: false,
  };
  cache.save(feed);
  cache.save(search);
  assert.equal(cache.get(feed.key), feed);
  assert.equal(cache.get(search.key), search);
  assert.equal(cache.get(feedKey('me', 'feed', 'following', '')), undefined);
  assert.equal(
    cache.get(feedKey('me', 'search', '', 'another query')),
    undefined,
  );
  assert.equal(cache.get(feed.key).posts[0], feed.posts[0]);
  const updated = { ...feed, posts: [{ id: 'new' }] };
  cache.save(updated);
  assert.equal(cache.get(feed.key), updated);
});
void test('account and privacy changes discard snapshots; late results cannot refill the old scope', () => {
  const cache = createFeedSnapshots();
  cache.reset('me', 0);
  const snapshot = {
    key: feedKey('me', 'feed', 'all', ''),
    posts: [{ id: 'private' }],
    hasMore: false,
  };
  cache.save(snapshot);
  cache.reset('other', 0);
  cache.save(snapshot);
  assert.equal(cache.get(snapshot.key), undefined);
  cache.reset('me', 0);
  cache.save(snapshot);
  cache.reset('me', 1);
  cache.save(snapshot);
  assert.equal(cache.get(snapshot.key), undefined);
});
void test('typing can retain only results from the same account and privacy revision', () => {
  const key = feedKey('me', 'search', '', 'one');
  assert.equal(sameSearch(key, feedKey('me', 'search', '', 'two')), true);
  for (const other of [
    feedKey('other', 'search', '', 'two'),
    feedKey('me', 'feed', 'all', ''),
    feedKey('me', 'search', '', 'two', '', '', 1),
    '',
  ])
    assert.equal(sameSearch(key, other), false);
});
void test('snapshots are bounded and exclude profiles and unrelated views', () => {
  const cache = createFeedSnapshots();
  cache.reset('me', 0);
  const keys = Array.from({ length: 10 }, (_, i) =>
    feedKey('me', 'search', '', String(i)),
  );
  keys.forEach((key) => cache.save({ key, posts: [], hasMore: false }));
  assert.equal(cache.get(keys[0]), undefined);
  assert.equal(cache.get(keys[1]), undefined);
  assert.ok(cache.get(keys[2]));
  const profile = feedKey('me', 'profile', '', '', 'someone', 'posts');
  cache.save({ key: profile, posts: [], hasMore: false });
  assert.equal(cache.get(profile), undefined);
});

void test('post changes propagate to cached views and hidden/deleted posts cannot return from a snapshot', () => {
  const cache = createFeedSnapshots();
  cache.reset('me', 0);
  const keys = [
    feedKey('me', 'feed', 'all', ''),
    feedKey('me', 'search', '', 'query'),
  ];
  keys.forEach((key) =>
    cache.save({
      key,
      posts: [{ id: 'post', likes: 0 }, { id: 'other' }],
      hasMore: false,
    }),
  );
  const updated = { id: 'post', likes: 1 };
  cache.update(updated);
  keys.forEach((key) => assert.equal(cache.get(key).posts[0], updated));
  cache.remove('post');
  keys.forEach((key) =>
    assert.deepEqual(
      cache.get(key).posts.map((post) => post.id),
      ['other'],
    ),
  );
  cache.clear();
  keys.forEach((key) => assert.equal(cache.get(key), undefined));
});
