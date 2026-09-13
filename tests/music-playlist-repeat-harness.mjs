import assert from 'node:assert/strict';

// Uses the actual playlist API and SQLite adapter from music-playlists.test.mjs.
export async function checkPlaylistRepeat(api, start) {
  let now = start;
  const a = 'repeat-alice-session-123',
    b = 'repeat-bob-session-123';
  let detail = await api.changePlaylist(
    'alice',
    { action: 'create', name: 'Repeat checks', trackIds: ['first', 'second'] },
    now,
  );
  const id = detail.id;
  assert.equal(detail.playback.repeatOne, 0);
  await api.changePlaylist(
    'alice',
    { action: 'invite', id, handle: 'bob' },
    now,
  );
  await api.changePlaylist('bob', { action: 'accept', id }, now);
  await api.changePlaylist('alice', { action: 'join', id, session: a }, now);
  await api.changePlaylist('bob', { action: 'join', id, session: b }, now);
  const control = async (command, extra = {}, user = 'alice') => {
    const before = await api.readPlaylist(user, id, now);
    detail = await api.changePlaylist(
      user,
      {
        action: 'control',
        id,
        session: user === 'alice' ? a : b,
        revision: before.playback.revision,
        command,
        ...extra,
      },
      now,
    );
    return detail;
  };
  await control('play', { trackId: 'first' });
  await control('duration', { durationMs: 120000 });
  now += 1234;
  await control('repeat', { enabled: true }, 'bob');
  assert.equal(detail.playback.repeatOne, 1);
  assert.equal(detail.playback.trackId, 'first');
  assert.equal(detail.playback.positionMs, 1234);
  assert.equal(
    detail.playback.playing,
    1,
    'Changing repeat preserves the running timeline',
  );
  assert.equal(
    (await api.readPlaylist('alice', id, now)).playback.repeatOne,
    1,
  );
  await control('seek', { positionMs: detail.playback.durationMs - 10 });
  now += 20;
  const revision = detail.playback.revision;
  const ends = await Promise.allSettled([
    api.changePlaylist(
      'alice',
      { action: 'control', id, session: a, revision, command: 'advance' },
      now,
    ),
    api.changePlaylist(
      'bob',
      { action: 'control', id, session: b, revision, command: 'advance' },
      now,
    ),
  ]);
  assert.equal(ends.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(ends.find((r) => r.status === 'rejected').reason.status, 409);
  detail = await api.readPlaylist('alice', id, now);
  assert.equal(detail.playback.trackId, 'first', 'End repeats the same track');
  assert.equal(detail.playback.positionMs, 0);
  assert.equal(
    detail.playback.durationMs,
    120000,
    'Repeating keeps the duration learned by the player',
  );
  assert.equal(
    detail.playback.revision,
    revision + 1,
    'Two listeners can restart only once',
  );
  await assert.rejects(control('advance'), (e) => e.status === 409);
  await control('play', { trackId: 'second' });
  assert.equal(
    detail.playback.trackId,
    'second',
    'Manual Next still changes the track',
  );
  assert.equal(detail.playback.repeatOne, 1);
  await control('pause');
  const position = detail.playback.positionMs;
  await control('repeat', { enabled: false });
  assert.equal(detail.playback.playing, 0, 'Repeat never starts paused audio');
  assert.equal(detail.playback.positionMs, position);
  await control('resume');
  await control('seek', { positionMs: detail.playback.durationMs - 10 });
  now += 20;
  await control('advance');
  assert.equal(
    detail.playback.trackId,
    'first',
    'Disabling repeat restores playlist order',
  );
  const safeRevision = detail.playback.revision;
  for (const enabled of [undefined, 'true', 1, null])
    await assert.rejects(
      control('repeat', { enabled }),
      (e) => e.status === 400,
    );
  for (const [user, token, expected] of [
    ['carol', a, 404],
    ['alice', 'wrong-session-token-123', 409],
  ]) {
    await assert.rejects(
      api.changePlaylist(
        user,
        {
          action: 'control',
          id,
          session: token,
          revision: safeRevision,
          command: 'repeat',
          enabled: true,
        },
        now,
      ),
      (e) => e.status === expected,
    );
  }
  assert.equal(
    (await api.readPlaylist('alice', id, now)).playback.revision,
    safeRevision,
  );
  await api.changePlaylist('alice', { action: 'delete', id }, now);

  const empty = await api.changePlaylist(
    'alice',
    { action: 'create', name: 'Empty repeat' },
    now,
  );
  await api.changePlaylist(
    'alice',
    { action: 'join', id: empty.id, session: a },
    now,
  );
  const updated = await api.changePlaylist(
    'alice',
    {
      action: 'control',
      id: empty.id,
      session: a,
      revision: 0,
      command: 'repeat',
      enabled: true,
    },
    now,
  );
  assert.equal(updated.playback.repeatOne, 1);
  assert.equal(updated.playback.trackId, null);
  assert.equal(updated.playback.playing, 0);
  await api.changePlaylist('alice', { action: 'delete', id: empty.id }, now);
  console.log(
    'Shared repeat: persistence, permissions, strict input, uninterrupted timeline, manual skip, pause, disable and concurrent end events passed.',
  );
}
