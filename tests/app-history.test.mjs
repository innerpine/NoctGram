import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/app-history.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { createAppHistory, appRouteFromURL, appRouteHref, appRouteKey } =
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(compiled.outputFiles[0].text).toString('base64')
  );
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

// A session history with capture/bubble ordering, including an earlier account
// picker entry. No browser, network requests or test-account mutations needed.
function fixture(href = '/', prepare, render) {
  const entries = [
    { url: new URL('/__dev/accounts', 'http://localhost:3000'), state: null },
    {
      url: new URL(href, 'http://localhost:3000'),
      state: { __NA: true, tree: ['existing-router-tree'], foreign: 'keep' },
    },
  ];
  let index = 1,
    ui,
    nativePops = 0;
  const listeners = [],
    commits = [],
    errors = [],
    preparations = [];
  const host = {
    get location() {
      return entries[index].url;
    },
    history: {
      get state() {
        return entries[index].state;
      },
      pushState(state, _, href) {
        entries.splice(index + 1);
        entries.push({
          state: structuredClone(state),
          url: new URL(href, host.location),
        });
        index++;
      },
      replaceState(state, _, href) {
        entries[index] = {
          state: structuredClone(state),
          url: new URL(href, host.location),
        };
      },
    },
    addEventListener(type, fn, capture = false) {
      listeners.push({ type, fn, capture });
    },
    removeEventListener(type, fn, capture = false) {
      const at = listeners.findIndex(
        (entry) =>
          entry.type === type && entry.fn === fn && entry.capture === capture,
      );
      if (at >= 0) listeners.splice(at, 1);
    },
  };
  host.addEventListener('popstate', () => nativePops++);
  const observe = (route) => {
    ui = route;
    controller.observe(route);
  };
  const controller = createAppHistory(host, {
    owner: 'me',
    initial: { page: 'feed' },
    render,
    error: (error) => errors.push(error),
    prepare: async (route) => {
      preparations.push(route);
      const resolved = (await prepare?.(route)) || route;
      return {
        route: resolved,
        commit: () => {
          commits.push(resolved);
          observe(resolved);
        },
      };
    },
  });
  return {
    host,
    controller,
    entries,
    commits,
    errors,
    preparations,
    observe,
    get ui() {
      return ui;
    },
    get nativePops() {
      return nativePops;
    },
    get index() {
      return index;
    },
    pop(delta) {
      index = Math.max(0, Math.min(entries.length - 1, index + delta));
      let stopped = false;
      const event = {
        state: host.history.state,
        stopImmediatePropagation() {
          stopped = true;
        },
      };
      for (const { fn } of [...listeners].sort(
        (a, b) => Number(b.capture) - Number(a.capture),
      )) {
        if (stopped) break;
        fn(event);
      }
      return stopped;
    },
  };
}

void test('URLs restore app sections, profile tabs, selected chats and legacy deep links', () => {
  const routes = [
    { page: 'feed', mode: 'following' },
    { page: 'messages' },
    { page: 'messages', peerId: 'friend & one' },
    { page: 'profile', profileId: 'friend', profileTab: 'gifts' },
    { page: 'profile', profileId: 'channel', boost: true },
    { page: 'profile', handle: 'Flyather', profileTab: 'media' },
    { page: 'search', query: 'музыка & люди' },
    { page: 'music' },
    { page: 'music', musicTab: 'charts' },
    { page: 'music', musicTab: 'library' },
    { page: 'music-services' },
    { page: 'saved' },
    { page: 'channels' },
    { page: 'premium' },
    { page: 'stars' },
    { page: 'moderation' },
  ];
  for (const route of routes)
    assert.equal(
      appRouteKey(appRouteFromURL(appRouteHref(route), 'me')),
      appRouteKey(route),
    );
  assert.equal(
    appRouteHref(appRouteFromURL('/?gifts=1', 'me')),
    '/?profile=me&tab=gifts',
  );
  assert.equal(
    appRouteHref(appRouteFromURL('/?page=profile', 'me')),
    '/?profile=me',
  );
  assert.equal(appRouteHref(appRouteFromURL('/?page=unknown', 'me')), '/');
  assert.equal(
    appRouteHref(appRouteFromURL('/?profile=one&tab=invalid', 'me')),
    '/?profile=one',
  );
});

void test('messages → profiles → gift tab restores in both directions without resetting browser history', async () => {
  const f = fixture();
  await f.controller.ready;
  assert.equal(
    f.entries.length,
    2,
    'Initialization replaces only the current entry',
  );
  f.observe({ page: 'messages', peerId: 'friend' });
  await f.controller.navigate({ page: 'profile', profileId: 'friend' });
  await f.controller.navigate({ page: 'profile', profileId: 'me' });
  f.observe({ page: 'profile', profileId: 'me', profileTab: 'gifts' });
  const length = f.entries.length;
  assert.equal(f.pop(-1), true);
  await tick();
  assert.equal(f.ui.profileId, 'me');
  assert.equal(f.ui.profileTab, 'posts');
  f.pop(-1);
  await tick();
  assert.equal(f.ui.profileId, 'friend');
  f.pop(-1);
  await tick();
  assert.equal(f.ui.page, 'messages');
  assert.equal(f.ui.peerId, 'friend');
  f.pop(1);
  await tick();
  assert.equal(f.ui.profileId, 'friend');
  f.pop(1);
  await tick();
  f.pop(1);
  await tick();
  assert.equal(f.ui.profileTab, 'gifts');
  assert.equal(
    f.entries.length,
    length,
    'Restoration must never append an entry',
  );
  assert.equal(
    f.nativePops,
    0,
    'Owned views must not trigger a framework tree reload',
  );
  assert.equal(f.host.history.state.foreign, 'keep');
  assert.deepEqual(f.host.history.state.tree, ['existing-router-tree']);
});

void test('search typing replaces its entry, while sections, profile tabs and peers add entries', async () => {
  const f = fixture();
  await f.controller.ready;
  f.observe({ page: 'search', query: '' });
  const searchLength = f.entries.length;
  for (const query of ['а', 'ан', 'аня']) f.observe({ page: 'search', query });
  assert.equal(f.entries.length, searchLength);
  f.observe({
    page: 'search',
    query: 'аня',
    profileId: 'background-update',
    peerId: 'friend',
  });
  assert.equal(
    f.entries.length,
    searchLength,
    'Unrelated data changes are not navigation',
  );
  f.observe({ page: 'messages', peerId: 'a' });
  f.observe({ page: 'messages', peerId: 'b' });
  f.pop(-1);
  await tick();
  assert.equal(f.ui.peerId, 'a');
  f.pop(-1);
  await tick();
  assert.equal(f.ui.query, 'аня');
  f.pop(-1);
  await tick();
  assert.equal(f.ui.page, 'feed');
});

void test('same-view clicks preserve the current chat and do not prepare or remount it', async () => {
  const f = fixture('/?chat=friend');
  await f.controller.ready;
  const count = f.commits.length;
  await f.controller.navigate({ page: 'messages', peerId: 'friend' });
  assert.equal(f.commits.length, count);
  assert.equal(f.preparations.length, 1);
  assert.equal(f.entries.length, 2);
});

void test('delayed visual commits keep URL and content together and reject obsolete callbacks', async () => {
  const queued = [];
  const f = fixture('/', undefined, async (from, to, update, initial) => {
    if (initial) return update();
    const wait = deferred();
    queued.push({
      from,
      to,
      apply: () => {
        update();
        wait.resolve();
      },
    });
    await wait.promise;
  });
  await f.controller.ready;
  const first = f.controller.navigate({ page: 'music' });
  await tick();
  assert.equal(f.ui.page, 'feed');
  assert.equal(f.host.location.pathname, '/');
  const second = f.controller.navigate({
    page: 'profile',
    profileId: 'friend',
  });
  await tick();
  queued[0].apply();
  assert.equal(await first, false);
  assert.equal(f.ui.page, 'feed');
  assert.equal(f.host.location.pathname, '/');
  queued[1].apply();
  assert.equal(await second, true);
  assert.equal(f.ui.profileId, 'friend');
  assert.equal(f.host.location.search, '?profile=friend');
  assert.equal(f.entries.length, 3);
});

void test('a sidebar cancellation also invalidates a queued animation commit', async () => {
  let apply;
  const wait = deferred();
  const f = fixture('/', undefined, async (from, to, update, initial) => {
    if (initial) return update();
    apply = update;
    await wait.promise;
  });
  await f.controller.ready;
  const pending = f.controller.navigate({ page: 'music' });
  await tick();
  f.controller.cancelPending();
  f.observe({ page: 'messages' });
  apply();
  wait.resolve();
  assert.equal(await pending, false);
  assert.equal(f.ui.page, 'messages');
  assert.equal(f.host.location.search, '?page=messages');
});

void test('music chart links and library/service transitions remain in app history', async () => {
  const f = fixture('/music?tab=charts');
  await f.controller.ready;
  assert.equal(f.ui.musicTab, 'charts');
  assert.equal(f.host.location.search, '?tab=charts');
  f.observe({ page: 'music', musicTab: 'library' });
  f.observe({ page: 'music-services' });
  f.pop(-1);
  await tick();
  assert.equal(f.ui.musicTab, 'library');
  f.pop(-1);
  await tick();
  assert.equal(f.ui.musicTab, 'charts');
  f.pop(1);
  await tick();
  assert.equal(f.ui.musicTab, 'library');
  assert.equal(f.nativePops, 0);
});

void test('reload honors the URL and resolves profile handles once; callback parameters survive initialization', async () => {
  const f = fixture(
    '/?handle=Flyather&tab=gifts&post=post-1',
    async (route) => ({ ...route, handle: '', profileId: 'resolved-id' }),
  );
  await f.controller.ready;
  assert.equal(f.ui.profileId, 'resolved-id');
  assert.equal(f.ui.profileTab, 'gifts');
  assert.equal(
    f.host.location.search,
    '?profile=resolved-id&tab=gifts&post=post-1',
  );
  assert.equal(f.entries.length, 2);
  const music = fixture('/music/services?provider=spotify&result=connected');
  await music.controller.ready;
  assert.equal(music.ui.page, 'music-services');
  assert.equal(
    music.host.location.search,
    '?provider=spotify&result=connected',
  );
});

void test('stale asynchronous profiles cannot override newer navigation or a sidebar click', async () => {
  const slow = deferred();
  const f = fixture('/', (route) =>
    route.profileId === 'slow' ? slow.promise : undefined,
  );
  await f.controller.ready;
  const pending = f.controller.navigate({ page: 'profile', profileId: 'slow' });
  await f.controller.navigate({ page: 'profile', profileId: 'fast' });
  slow.resolve({ page: 'profile', profileId: 'slow' });
  assert.equal(await pending, false);
  assert.equal(f.ui.profileId, 'fast');
  const blocked = deferred();
  const second = fixture('/', (route) =>
    route.profileId ? blocked.promise : undefined,
  );
  await second.controller.ready;
  const request = second.controller.navigate({
    page: 'profile',
    profileId: 'slow',
  });
  second.controller.cancelPending();
  second.observe({ page: 'music' });
  blocked.resolve({ page: 'profile', profileId: 'slow' });
  await request;
  assert.equal(second.ui.page, 'music');
  assert.equal(second.host.location.pathname, '/music');
});

void test('rapid Back/Forward commits only the most recent traversal', async () => {
  let delayed = false;
  const pending = deferred();
  const f = fixture('/', (route) =>
    delayed && route.profileId === 'one' ? pending.promise : undefined,
  );
  await f.controller.ready;
  await f.controller.navigate({ page: 'profile', profileId: 'one' });
  await f.controller.navigate({ page: 'profile', profileId: 'two' });
  delayed = true;
  f.pop(-1);
  f.pop(1);
  await tick();
  assert.equal(f.ui.profileId, 'two');
  pending.resolve({ page: 'profile', profileId: 'one' });
  await tick();
  assert.equal(f.ui.profileId, 'two');
  assert.equal(f.host.location.search, '?profile=two');
  assert.equal(f.entries.length, 4);
});

void test('Back beyond the first app entry stays native and invalidates pending work', async () => {
  const slow = deferred();
  const f = fixture('/', (route) =>
    route.profileId ? slow.promise : undefined,
  );
  await f.controller.ready;
  const pending = f.controller.navigate({ page: 'profile', profileId: 'slow' });
  assert.equal(f.pop(-1), false);
  assert.equal(f.nativePops, 1);
  slow.resolve({ page: 'profile', profileId: 'slow' });
  assert.equal(await pending, false);
  assert.equal(f.host.location.pathname, '/__dev/accounts');
  assert.equal(f.host.history.state, null);
  f.controller.observe({ page: 'music' });
  assert.equal(f.host.location.pathname, '/__dev/accounts');
});

void test('unowned entries and other accounts are left to the native router', async () => {
  for (const state of [
    null,
    { arbitrary: true },
    {
      __noctgramNavigation: {
        version: 1,
        owner: 'other-account',
        route: { page: 'profile', profileId: 'private' },
      },
    },
  ]) {
    const f = fixture();
    await f.controller.ready;
    f.entries[0] = { url: new URL('http://localhost:3000/'), state };
    assert.equal(f.pop(-1), false);
    await tick();
    assert.equal(f.nativePops, 1);
    assert.equal(f.ui.page, 'feed');
    assert.equal(f.commits.length, 1);
  }
});

void test('failed restoration keeps the displayed view and URL consistent; disposal prevents commits', async () => {
  let fail = false;
  const f = fixture('/', (route) => {
    if (fail && route.profileId === 'gone')
      throw new Error('Профиль недоступен');
  });
  await f.controller.ready;
  await f.controller.navigate({ page: 'profile', profileId: 'gone' });
  await f.controller.navigate({ page: 'messages', peerId: 'friend' });
  fail = true;
  f.pop(-1);
  await tick();
  assert.equal(f.ui.page, 'messages');
  assert.equal(f.host.location.search, '?chat=friend');
  assert.deepEqual(f.errors, ['Профиль недоступен']);
  const slow = deferred();
  const disposed = fixture('/?profile=slow', () => slow.promise);
  disposed.controller.dispose();
  slow.resolve({ page: 'profile', profileId: 'slow' });
  assert.equal(await disposed.controller.ready, false);
  assert.equal(disposed.commits.length, 0);
  assert.equal(await disposed.controller.navigate({ page: 'music' }), false);
});
