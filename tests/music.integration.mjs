import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Music tests require an isolated local Worker');
const run = Date.now(),
  alice = 'music_alice_' + run,
  bob = 'music_bob_' + run;
const url = 'https://soundcloud.com/noctgram-qa/test-track';
async function api(user, body) {
  const response = await fetch(
    base + '/api/music' + (body ? '' : '?action=home'),
    {
      headers: {
        ...(user
          ? {
              'oai-authenticated-user-id': user,
              'oai-authenticated-user-email': 'music-qa@example.test',
            }
          : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    },
  );
  return { status: response.status, data: await response.json() };
}
assert.equal((await api()).status, 401);
assert.equal((await api('music_qa_blocked')).status, 403);
assert.equal(
  (await api('music_qa_readonly', { action: 'save', url })).status,
  403,
);
assert.equal(
  (
    await api('music_qa_readonly', {
      action: 'preferences',
      participate: false,
    })
  ).status,
  200,
);
assert.equal((await api(alice)).data.participate, false);
assert.deepEqual((await api(alice, { action: 'start', url })).data, {
  session: null,
});
assert.equal(
  (await api(alice, { action: 'save', url: 'https://example.com/track' }))
    .status,
  400,
);
assert.equal(
  (await api(alice, { action: 'save', url: url + '?secret_token=s-secret' }))
    .status,
  400,
);
assert.equal((await api(alice, { action: 'save', url })).status, 200);
assert.equal((await api(alice, { action: 'save', url })).status, 200);
assert.equal(
  (await api(alice)).data.library.filter((t) => t.url === url).length,
  1,
);
assert.equal((await api(bob)).data.library.length, 0);
assert.equal(
  (await api(bob)).data.discoveries.some((t) => t.url === url),
  true,
);
await api(bob, { action: 'remove', id: 'music_qa_track' });
assert.equal((await api(alice)).data.library.length, 1);
await api(alice, { action: 'preferences', participate: true });
const first = (await api(alice, { action: 'start', url })).data.session;
const session = (await api(alice, { action: 'start', url })).data.session;
assert.ok(session && session !== first);
assert.equal(
  (await api(alice, { action: 'progress', session: first, totalMs: 0 })).status,
  409,
);
assert.equal(
  (await api(bob, { action: 'progress', session, totalMs: 0 })).status,
  409,
);
assert.equal(
  (await api(alice, { action: 'progress', session, totalMs: 30000 })).status,
  409,
);
assert.equal(
  (await api(alice, { action: 'progress', session, totalMs: -1 })).status,
  400,
);
assert.equal(
  (await api(alice, { action: 'progress', session, totalMs: 0 })).status,
  200,
);
console.log(
  'Auth, privacy, library ownership, opt-in, superseded sessions and early-event checks passed. Waiting for the server-time threshold…',
);
await sleep(31000);
const counts = await Promise.all(
  Array.from({ length: 4 }, () =>
    api(alice, { action: 'progress', session, totalMs: 30000 }),
  ),
);
assert.ok(counts.every((r) => r.status === 200 && r.data.counted));
let data = (await api(alice)).data;
const before = data.tracks.find((t) => t.id === 'music_qa_track').plays;
const ownIndex = data.listeners.findIndex((p) => p.id === alice);
assert.equal(data.mine.plays, 1);
if (ownIndex >= 0) assert.equal(data.mine.rank, ownIndex + 1);
else assert.ok(data.mine.rank > 30);
assert.ok(data.mine.participants >= 1);
assert.equal(
  data.artists.find((a) => a.authorUrl === 'https://soundcloud.com/noctgram-qa')
    .plays >= 1,
  true,
);
assert.equal(
  (await api(alice, { action: 'progress', session, totalMs: 29999 })).status,
  409,
);
assert.equal(
  (await api(alice, { action: 'progress', session, totalMs: 30000 })).data
    .counted,
  true,
);
assert.equal(
  (await api(alice)).data.tracks.find((t) => t.id === 'music_qa_track').plays,
  before,
);
assert.deepEqual((await api(alice, { action: 'start', url })).data, {
  session: null,
  counted: true,
});
// Starting an already counted track invalidates the previous session.
assert.equal(
  (await api(alice, { action: 'progress', session, totalMs: 30000 })).status,
  409,
);
await api(alice, { action: 'preferences', participate: false });
assert.equal(
  (await api(alice, { action: 'progress', session, totalMs: 30000 })).status,
  409,
);
data = (await api(alice)).data;
assert.equal(
  data.listeners.some((p) => p.id === alice),
  false,
);
assert.equal(data.participate, false);
await api(alice, { action: 'remove', id: 'music_qa_track' });
assert.equal((await api(alice)).data.library.length, 0);
console.log(
  'Music integration passed: concurrent/repeated progress counts once; consent withdrawal erases the listener history.',
);
