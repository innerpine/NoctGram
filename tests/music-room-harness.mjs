import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Runs the real hook and API against SQLite with a controlled audio adapter and
// clock. No browser, external music requests or production account writes.
export async function checkMusicRoom(api, start) {
  const saved = new Map(
    [
      'fetch',
      'window',
      'document',
      'navigator',
      'performance',
      'setInterval',
      'clearInterval',
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  let now = start,
    cursor = 0,
    first = true,
    renderQueued = false,
    output;
  const slots = [],
    effects = [],
    timers = new Map(),
    calls = [];
  let timerId = 0;
  let delayedControl = null;
  const requests = [];
  const delayControl = (command, phase = 'before') => {
    let release;
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    delayedControl = { command, phase, wait };
    return () => release();
  };
  const engine = {
    url: '',
    position: 0,
    duration: 0,
    ready: false,
    playing: false,
    error: '',
    blocked: false,
    play(track) {
      calls.push(['play', track.url]);
      engine.url = track.url;
      engine.position = 0;
      engine.duration = 0;
      engine.ready = false;
      engine.playing = false;
      render();
    },
    seek(ms) {
      calls.push(['seek', ms]);
      engine.position = ms;
      render();
    },
    setPlaying(active) {
      calls.push(['playing', active]);
      engine.playing = active;
      render();
    },
    stop() {
      calls.push(['stop']);
      engine.url = '';
      engine.playing = false;
      engine.ready = false;
      render();
    },
  };
  const rerender = () => {
    if (!renderQueued) {
      renderQueued = true;
      queueMicrotask(() => {
        renderQueued = false;
        render();
      });
    }
  };
  globalThis.__roomHooks = {
    useRef(value) {
      const index = cursor++;
      if (first) slots[index] = { current: value };
      return slots[index];
    },
    useState(value) {
      const index = cursor++;
      if (first) slots[index] = value;
      return [
        slots[index],
        (next) => {
          slots[index] = typeof next === 'function' ? next(slots[index]) : next;
          rerender();
        },
      ];
    },
    useEffect(effect) {
      cursor++;
      if (first) effects.push(effect);
    },
    useMemo(factory, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i])))
        slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
  };
  const set = (key, value) =>
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  set('window', new EventTarget());
  set('document', Object.assign(new EventTarget(), { hidden: false }));
  set('navigator', { sendBeacon: () => true });
  set('performance', { now: () => now - start + 100000 });
  set('setInterval', (fn, ms) => {
    const id = ++timerId;
    timers.set(id, { fn, ms, next: now + ms });
    return id;
  });
  set('clearInterval', (id) => timers.delete(id));
  set('fetch', async (url, options = {}) => {
    try {
      const body = options.body ? JSON.parse(options.body) : null;
      let delay = null;
      if (body?.action === 'control') {
        requests.push(body);
        if (delayedControl?.command === body.command) {
          delay = delayedControl;
          delayedControl = null;
        }
      }
      if (delay?.phase === 'before') await delay.wait;
      const data = body
        ? await api.changePlaylist('alice', body, now)
        : await api.readPlaylist(
            'alice',
            new URL(url, 'http://localhost').searchParams.get('id'),
            now,
          );
      if (delay?.phase === 'after') await delay.wait;
      return Response.json(data);
    } catch (error) {
      return Response.json(
        { error: error.message },
        { status: error.status || 500 },
      );
    }
  });
  const compiled = await build({
    entryPoints: ['lib/use-music-room.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'effect-harness',
        setup(build) {
          build.onResolve({ filter: /^react$/ }, () => ({
            path: 'react',
            namespace: 'test',
          }));
          build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
            contents:
              'export const { useRef, useState, useEffect, useMemo } = globalThis.__roomHooks;',
          }));
        },
      },
    ],
  });
  const { useMusicRoom } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(compiled.outputFiles[0].text).toString('base64')
  );
  function render() {
    cursor = 0;
    // The harness supplies an explicit hook dispatcher without a browser renderer.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    output = useMusicRoom({ ...engine });
    first = false;
  }
  const flush = async () => {
    for (let i = 0; i < 15; i++)
      await new Promise((resolve) => setImmediate(resolve));
  };
  async function step(ms) {
    if (engine.playing) engine.position += ms;
    now += ms;
    render();
    for (const item of timers.values())
      if (item.next <= now) {
        item.next = now + item.ms;
        item.fn();
      }
    await flush();
  }
  const cleanup = [];
  try {
    let detail = await api.changePlaylist(
      'alice',
      { action: 'create', name: 'Room integration' },
      now,
    );
    const id = detail.id;
    for (const url of [
      'https://soundcloud.com/test/first',
      'https://soundcloud.com/test/second',
    ])
      await api.changePlaylist('alice', { action: 'add', id, url }, now++);
    await api.changePlaylist(
      'alice',
      { action: 'invite', id, handle: 'bob' },
      now,
    );
    await api.changePlaylist('bob', { action: 'accept', id }, now);
    const bob = 'bob-room-integration-123';
    await api.changePlaylist('bob', { action: 'join', id, session: bob }, now);
    detail = await api.changePlaylist(
      'bob',
      {
        action: 'control',
        id,
        session: bob,
        command: 'play',
        trackId: 'first',
        revision: 0,
      },
      now,
    );
    render();
    for (const effect of effects) cleanup.push(effect());
    const idleRoom = output;
    engine.position += 100;
    render();
    assert.equal(
      output,
      idleRoom,
      'Position samples do not invalidate room controls',
    );
    await step(12000);
    await output.join(detail);
    await flush();
    await step(250);
    assert.equal(engine.url, 'https://soundcloud.com/test/first');
    assert.equal(calls.filter((c) => c[0] === 'play').length, 1);
    engine.ready = true;
    engine.duration = 120000;
    engine.blocked = true;
    render();
    const blockedCalls = calls.length;
    await step(3000);
    assert.equal(
      calls.length,
      blockedCalls,
      'Blocked autoplay is not retried by room synchronization',
    );
    assert.equal(engine.playing, false);
    engine.blocked = false;
    render();
    await step(1000);
    assert.equal(engine.playing, true);
    assert.ok(
      engine.position >= 12000,
      'Late join seeks to the shared server position',
    );
    const afterInitialSync = calls.filter((c) => c[0] === 'seek').length;
    await step(1000);
    assert.equal(
      calls.filter((c) => c[0] === 'seek').length,
      afterInitialSync,
      'Learning the duration must not seek a second time during playback',
    );
    const control = async (command, extra = {}) => {
      const current = await api.readPlaylist('bob', id, now);
      return api.changePlaylist(
        'bob',
        {
          action: 'control',
          id,
          session: bob,
          revision: current.playback.revision,
          command,
          ...extra,
        },
        now,
      );
    };
    const beforeMetadata = calls.length;
    await control('duration', { durationMs: 120001 });
    await step(2000);
    await step(1000);
    assert.deepEqual(
      calls.slice(beforeMetadata),
      [],
      'Another listener reporting metadata cannot interrupt aligned audio',
    );
    const beforeSmallSeek = calls.filter((c) => c[0] === 'seek').length;
    const smallSeekTarget = engine.position + 750;
    await control('seek', { positionMs: smallSeekTarget });
    await step(2000);
    await step(1000);
    assert.equal(engine.position, smallSeekTarget + 3000);
    assert.equal(
      calls.filter((c) => c[0] === 'seek').length,
      beforeSmallSeek + 1,
      'An intentional remote seek below the drift threshold still applies once',
    );
    engine.position -= 3500;
    render();
    const beforeDrift = calls.filter((c) => c[0] === 'seek').length;
    await step(1000);
    assert.equal(
      calls.filter((c) => c[0] === 'seek').length,
      beforeDrift + 1,
      'Real playback drift is corrected without a new server revision',
    );
    await control('pause');
    await step(2000);
    await step(1000);
    assert.equal(
      engine.playing,
      false,
      'A remote pause reaches the actual audio adapter',
    );
    const pausedAt = engine.position;
    await step(3000);
    assert.equal(engine.position, pausedAt);
    await control('seek', { positionMs: 42000 });
    await step(2000);
    await step(1000);
    assert.equal(engine.position, 42000);
    assert.equal(
      engine.playing,
      false,
      'Seeking a paused room must not resume it',
    );

    // A slow seek used to block every playlist row and be overwritten by polls.
    const seekCalls = calls.filter((c) => c[0] === 'seek').length;
    const releasePausedSeek = delayControl('seek');
    const pausedSeek = output.command('seek', { positionMs: 52000 });
    assert.equal(engine.position, 52000, 'Local seek does not wait for HTTP');
    await flush();
    assert.equal(output.busy, false, 'Seeking never disables the playlist');
    await step(3000);
    assert.equal(
      engine.position,
      52000,
      'Old room polls cannot rewind a pending seek',
    );
    assert.equal(engine.playing, false);
    releasePausedSeek();
    await pausedSeek;
    await step(1000);
    assert.equal(engine.position, 52000);
    assert.equal(engine.playing, false);
    assert.equal(
      calls.filter((c) => c[0] === 'seek').length,
      seekCalls + 1,
      'A seek acknowledgement does not issue another engine seek',
    );

    // A different listener's seek wins the CAS race; our final intent retries on
    // the latest revision, still paused, rather than silently disappearing.
    const releaseConflict = delayControl('seek');
    const conflictedSeek = output.command('seek', { positionMs: 62000 });
    await control('seek', { positionMs: 22000 });
    releaseConflict();
    await conflictedSeek;
    await step(1000);
    assert.equal(
      (await api.readPlaylist('bob', id, now)).playback.positionMs,
      62000,
    );
    assert.equal(engine.position, 62000);
    assert.equal(engine.playing, false);

    await control('resume');
    await step(2000);
    await step(1000);
    assert.equal(engine.playing, true);

    const releaseNativePause = delayControl('pause');
    const nativePause = output.command('pause');
    assert.equal(
      engine.playing,
      false,
      'Our pause button stops the adapter before the server replies',
    );
    await step(3000);
    assert.equal(
      engine.playing,
      false,
      'A pending native pause cannot be undone by a stale room poll',
    );
    releaseNativePause();
    await nativePause;
    await step(1000);
    await output.command('resume');
    await step(1000);
    assert.equal(engine.playing, true);

    // Several discrete seeks (e.g. held arrow keys) keep only the latest queued
    // position. Even a poll that sees the first POST must not undo that preview.
    const requestCount = requests.filter((r) => r.command === 'seek').length;
    const releasePlayingSeek = delayControl('seek', 'after');
    const firstSeek = output.command('seek', { positionMs: 15000 });
    await flush();
    await output.command('seek', { positionMs: 25000 });
    await output.command('seek', { positionMs: 35000 });
    assert.equal(engine.position, 35000);
    await step(3000);
    assert.equal(
      engine.position,
      38000,
      'Playback continues while the seek response is delayed',
    );
    assert.equal(engine.playing, true);
    assert.equal(output.busy, false);
    releasePlayingSeek();
    await firstSeek;
    await flush();
    assert.equal(
      (await api.readPlaylist('bob', id, now)).playback.positionMs,
      35000,
    );
    assert.equal(
      requests.filter((r) => r.command === 'seek').length,
      requestCount + 2,
    );
    assert.equal(
      engine.position,
      38000,
      'An older acknowledgement cannot apply an older seek',
    );
    assert.equal(engine.playing, true);
    assert.equal(
      calls.filter((c) => c[0] === 'play').length,
      1,
      'Heartbeats, pause, seek and resume do not recreate the engine',
    );
    await control('play', { trackId: 'second' });
    await step(2000);
    await step(1000);
    assert.equal(engine.url, 'https://soundcloud.com/test/second');
    assert.equal(calls.filter((c) => c[0] === 'play').length, 2);
    engine.ready = true;
    engine.duration = 140000;
    render();
    await step(1000);
    await output.command('pause');
    await flush();
    await step(1000);
    assert.equal(
      (await api.readPlaylist('bob', id, now)).playback.playing,
      0,
      'Local player buttons control the other listener too',
    );

    // Background tabs may throttle timers. Returning must fetch the room now,
    // without waiting for the next interval to discover a remote change.
    await control('resume');
    window.dispatchEvent(new Event('focus'));
    await flush();
    await step(1000);
    assert.equal(engine.playing, true, 'Focus reconciles a remote resume');
    await control('pause');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    await step(1000);
    assert.equal(
      engine.playing,
      false,
      'Visibility restoration reconciles a remote pause',
    );

    const releaseObsoleteSeek = delayControl('seek');
    const obsoleteSeek = output.command('seek', { positionMs: 88000 });
    await control('play', { trackId: 'first' });
    await step(2000);
    await step(1000);
    assert.equal(engine.url, 'https://soundcloud.com/test/first');
    releaseObsoleteSeek();
    await obsoleteSeek;
    const switched = await api.readPlaylist('bob', id, now);
    assert.equal(switched.playback.trackId, 'first');
    assert.equal(
      switched.playback.positionMs,
      0,
      'A delayed seek for the previous song never seeks the next song',
    );
    output.leave();
    await flush();
    const afterLeave = calls.length;
    await control('play', { trackId: 'first' });
    await step(3000);
    assert.equal(
      calls.length,
      afterLeave,
      'Leaving ignores later room commands',
    );
    await output.join(await api.readPlaylist('alice', id, now), 'first');
    engine.position = 0;
    engine.duration = 120000;
    engine.ready = true;
    engine.playing = true;
    render();
    const beforeFreshStart = calls.length;
    for (let i = 0; i < 12; i++) await step(250);
    assert.deepEqual(
      calls.slice(beforeFreshStart),
      [],
      'An already aligned new song plays its first seconds without seek/pause/restart',
    );
    const beforeReorder = calls.length;
    const beforeRevision = output.detail.playback.revision;
    await output.reorder('second', 'first');
    await flush();
    await step(250);
    assert.equal(output.detail.tracks[0].id, 'second');
    assert.equal(output.detail.playback.revision, beforeRevision);
    assert.deepEqual(
      calls.slice(beforeReorder),
      [],
      'Reordering a playing room never seeks, pauses or restarts its current song',
    );
    // A queued repeat keeps only its own button busy until the actual ack.
    const releaseRepeatSeek = delayControl('seek');
    const repeatSeek = output.command('seek', { positionMs: 5000 });
    await flush();
    await output.command('repeat', { enabled: true });
    await flush();
    assert.equal(output.repeatPending, true);
    assert.equal(output.busy, false);
    await output.command('repeat', { enabled: false });
    releaseRepeatSeek();
    await repeatSeek;
    await flush();
    assert.equal(output.repeatPending, false);
    assert.equal(output.detail.playback.repeatOne, 1);
    assert.equal(
      requests.filter((r) => r.command === 'repeat').length,
      1,
      'A pending repeat cannot be sent twice',
    );

    // A concurrent metadata update must not swallow a listener's repeat command.
    const beforeRepeat = calls.length;
    const releaseRepeat = delayControl('repeat');
    const repeatOff = output.command('repeat', { enabled: false });
    await flush();
    await control('duration', { durationMs: 120000 });
    releaseRepeat();
    await repeatOff;
    await flush();
    await step(2000);
    assert.equal(output.detail.playback.repeatOne, 0);
    assert.equal(output.repeatPending, false);
    assert.deepEqual(
      calls.slice(beforeRepeat),
      [],
      'A repeat toggle never seeks or restarts aligned audio',
    );
    await output.command('repeat', { enabled: true });
    await flush();
    await output.command('seek', { positionMs: 119999 });
    const playsBeforeLoop = calls.filter((c) => c[0] === 'play').length;
    await step(1000);
    await step(1000);
    assert.equal(output.detail.playback.trackId, 'first');
    assert.equal(engine.url, 'https://soundcloud.com/test/first');
    assert.ok(
      engine.position < 3000,
      'All listeners seek into the restarted timeline',
    );
    assert.equal(
      calls.filter((c) => c[0] === 'play').length,
      playsBeforeLoop,
      'Repeat reuses the loaded audio engine',
    );
    await control('repeat', { enabled: false });
    await step(2000);
    assert.equal(
      output.detail.playback.repeatOne,
      0,
      'Another listener can disable repeat',
    );
    await output.command('seek', { positionMs: 119999 });
    await step(1000);
    await step(1000);
    assert.equal(output.detail.playback.trackId, 'second');
    assert.equal(engine.url, 'https://soundcloud.com/test/second');
    const releaseObsoleteRepeat = delayControl('repeat');
    const obsoleteRepeat = output.command('repeat', { enabled: true });
    await flush();
    output.leave();
    await flush();
    assert.equal(output.repeatPending, false);
    releaseObsoleteRepeat();
    await obsoleteRepeat;
    await flush();
    assert.equal(
      output.detail,
      null,
      'A late repeat response cannot reopen a departed room',
    );
    await api.changePlaylist('alice', { action: 'delete', id }, now);
    console.log(
      'Shared room hook: uninterrupted startup and metadata updates, small remote seeks, drift correction, delayed seeks, responsive controls, CAS retry, track changes, pause/resume and leave verified against real API/SQLite.',
    );
  } finally {
    for (const dispose of cleanup) dispose?.();
    await flush();
    for (const [key, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    delete globalThis.__roomHooks;
  }
}
