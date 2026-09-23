import type { AppHistoryHost } from './app-history-bootstrap';

const STATE_KEY = '__noctgramNavigation';
const pages = new Set([
  'feed',
  'search',
  'profile',
  'messages',
  'saved',
  'channels',
  'music',
  'music-services',
  'premium',
  'stars',
  'moderation',
]);
const appPaths = new Set(['/', '/music', '/music/services']);

export type AppRoute = {
  page: string;
  profileId?: string;
  profileRef?: string;
  handle?: string;
  peerId?: string;
  roomId?: string;
  group?: string;
  invite?: string;
  profileTab?: string;
  musicTab?: string;
  mode?: string;
  query?: string;
  boost?: boolean;
};
export type PreparedRoute = { route: AppRoute; commit: () => void };

export function normalizeAppRoute(input: AppRoute): AppRoute {
  const page = pages.has(input.page) ? input.page : 'feed';
  const text = (value: unknown, limit = 100) =>
    typeof value === 'string' ? value.slice(0, limit) : '';
  if (page === 'profile')
    return {
      page,
      profileId: text(input.profileId),
      ...(!input.profileId && input.profileRef
        ? { profileRef: text(input.profileRef) }
        : {}),
      ...(input.boost ? { boost: true } : {}),
      handle: text(input.handle, 25)
        .replace(/^@/, '')
        .slice(0, 24)
        .toLowerCase(),
      profileTab: ['posts', 'media', 'gifts'].includes(input.profileTab || '')
        ? input.profileTab
        : 'posts',
    };
  if (page === 'messages') {
    if (input.roomId) return { page, roomId: text(input.roomId) };
    if (input.group)
      return {
        page,
        group: text(input.group, 24).replace(/^@/, '').toLowerCase(),
      };
    if (input.invite) return { page, invite: text(input.invite, 128) };
    return { page, peerId: text(input.peerId) };
  }
  if (page === 'music')
    return {
      page,
      musicTab: ['search', 'charts', 'library'].includes(input.musicTab || '')
        ? input.musicTab
        : 'playlists',
    };
  if (page === 'search') return { page, query: text(input.query, 200) };
  if (page === 'feed')
    return { page, mode: input.mode === 'following' ? 'following' : 'all' };
  return { page };
}
export const appRouteKey = (route: AppRoute) =>
  JSON.stringify(normalizeAppRoute(route));

export function appRouteFromURL(href: string, owner: string): AppRoute {
  const url = new URL(href, 'http://noctgram.local'),
    params = url.searchParams;
  if (
    params.has('boost') ||
    params.has('profile') ||
    params.has('handle') ||
    params.get('gifts') === '1'
  )
    return normalizeAppRoute({
      page: 'profile',
      profileRef: params.get('boost') || params.get('profile') || '',
      profileId:
        !params.get('boost') &&
        !params.get('profile') &&
        params.get('gifts') === '1'
          ? owner
          : '',
      ...(params.get('boost') ? { boost: true } : {}),
      handle: params.get('handle') || '',
      profileTab:
        params.get('gifts') === '1' ? 'gifts' : params.get('tab') || 'posts',
    });
  if (params.has('room') || params.has('group') || params.has('invite'))
    return normalizeAppRoute({
      page: 'messages',
      roomId: params.get('room') || '',
      group: params.get('group') || '',
      invite: params.get('invite') || '',
    });
  if (params.has('chat'))
    return normalizeAppRoute({
      page: 'messages',
      peerId: params.get('chat') || '',
    });
  return normalizeAppRoute({
    page:
      params.get('page') ||
      (url.pathname === '/music/services'
        ? 'music-services'
        : url.pathname === '/music'
          ? 'music'
          : 'feed'),
    profileId: params.get('page') === 'profile' ? owner : '',
    profileTab: params.get('tab') || '',
    musicTab: params.get('tab') || '',
    mode: params.get('mode') || '',
    query: params.get('q') || '',
  });
}
export function appRouteHref(input: AppRoute) {
  const route = normalizeAppRoute(input),
    params = new URLSearchParams();
  let path = '/';
  if (route.page === 'profile') {
    if (route.handle || route.profileId || route.profileRef)
      params.set(
        route.boost ? 'boost' : 'profile',
        route.handle || route.profileId || route.profileRef!,
      );
    else params.set('page', 'profile');
    if (route.profileTab !== 'posts') params.set('tab', route.profileTab!);
  } else if (route.page === 'messages') {
    if (route.roomId) params.set('room', route.roomId);
    else if (route.group) params.set('group', route.group);
    else if (route.invite) params.set('invite', route.invite);
    else if (route.peerId) params.set('chat', route.peerId);
    else params.set('page', 'messages');
  } else if (route.page === 'music') {
    path = '/music';
    if (route.musicTab !== 'playlists') params.set('tab', route.musicTab!);
  } else if (route.page === 'music-services') path = '/music/services';
  else if (route.page !== 'feed') params.set('page', route.page);
  if (route.query) params.set('q', route.query);
  if (route.mode === 'following') params.set('mode', 'following');
  return path + (params.size ? '?' + params : '');
}

/** Own only Noctgram view entries. Browser Back beyond the first view stays native. */
export function createAppHistory(
  host: AppHistoryHost,
  options: {
    owner: string;
    initial: AppRoute;
    prepare: (route: AppRoute) => Promise<PreparedRoute>;
    render?: (
      from: AppRoute,
      to: AppRoute,
      update: () => void,
      initial: boolean,
    ) => Promise<void>;
    error: (message: string) => void;
  },
) {
  let active = normalizeAppRoute(options.initial),
    observed = active;
  let generation = 0,
    pending = false,
    disposed = false,
    settling = '';
  // Own entries behind this one (depth) and where the current screen began
  // (base): tab switches inside one profile are a single screen for back().
  let depth = 0,
    base = 0,
    screen = '';
  const screenOf = (route: AppRoute) =>
    route.page === 'profile'
      ? 'profile:' + (route.profileId || route.handle || route.profileRef)
      : '';
  const stateEntry = (state: unknown) => {
    if (!state || typeof state !== 'object') return null;
    const entry = (state as Record<string, unknown>)[STATE_KEY] as
      | {
          version?: number;
          owner?: string;
          route?: AppRoute;
          depth?: number;
          base?: number;
        }
      | undefined;
    return entry?.version === 1 &&
      entry.owner === options.owner &&
      entry.route &&
      pages.has(entry.route.page)
      ? {
          route: normalizeAppRoute(entry.route),
          depth: Number(entry.depth) || 0,
          base: Number(entry.base) || 0,
        }
      : null;
  };
  const track = (entry: { depth: number; base: number; route: AppRoute }) => {
    depth = entry.depth;
    base = Math.min(entry.base, depth);
    screen = screenOf(entry.route);
  };
  const write = (
    mode: 'push' | 'replace',
    route: AppRoute,
    keepExtras = false,
  ) => {
    const href = new URL(appRouteHref(route), host.location.origin);
    if (keepExtras) {
      const current = new URL(host.location.href);
      for (const key of ['post', 'provider', 'result']) {
        const value = current.searchParams.get(key);
        if (value) href.searchParams.set(key, value);
      }
    }
    const next = screenOf(route);
    if (mode === 'push') depth++;
    if (!next || next !== screen) base = depth;
    screen = next;
    // Preserve the router's own metadata and any unrelated state fields.
    const state = {
      ...host.history.state,
      [STATE_KEY]: { version: 1, owner: options.owner, route, depth, base },
    };
    host.history[mode === 'push' ? 'pushState' : 'replaceState'](
      state,
      '',
      href.pathname + href.search,
    );
  };
  const cancelPending = () => {
    if (disposed) return;
    generation++;
    if (pending || settling) write('replace', active);
    pending = false;
    settling = '';
  };
  const transition = async (
    route: AppRoute,
    mode: 'push' | 'replace',
    initial = false,
  ) => {
    if (disposed) return false;
    const version = ++generation;
    pending = true;
    try {
      const prepared = await options.prepare(normalizeAppRoute(route));
      if (disposed || generation !== version) return false;
      const next = normalizeAppRoute(prepared.route);
      const changed = appRouteKey(next) !== appRouteKey(active);
      let committed = false;
      const commit = () => {
        if (disposed || generation !== version) return;
        active = next;
        settling =
          appRouteKey(observed) === appRouteKey(next) ? '' : appRouteKey(next);
        pending = false;
        write(mode === 'push' && changed ? 'push' : 'replace', next, initial);
        prepared.commit();
        committed = true;
      };
      if (options.render) await options.render(active, next, commit, initial);
      else commit();
      return committed;
    } catch (error) {
      if (disposed || generation !== version) return false;
      pending = false;
      settling = '';
      // A failed reload must retain its destination for Retry, not replace it
      // with the default feed before that destination has ever been displayed.
      if (mode === 'replace' && !initial) write('replace', active);
      options.error(
        error instanceof Error ? error.message : 'Не удалось открыть раздел',
      );
      return false;
    }
  };
  const pop = (event: PopStateEvent) => {
    const entry = stateEntry(event.state);
    if (!entry || !appPaths.has(host.location.pathname)) {
      // A native traversal can unmount the app asynchronously. Prevent an older
      // profile request from rewriting the destination URL in the meantime.
      disposed = true;
      generation++;
      detach();
      return;
    }
    // These entries describe client views in the mounted app. Letting the
    // framework also traverse them would reload the RSC tree and reset the player.
    event.stopImmediatePropagation();
    track(entry);
    void transition(entry.route, 'replace');
  };
  const bridge = host.__noctgramHistory;
  const detach = () => {
    if (bridge?.listener === pop) bridge.listener = null;
    host.removeEventListener('popstate', pop, true);
  };
  if (bridge) bridge.listener = pop;
  else host.addEventListener('popstate', pop, true);
  const initialRoute = appRouteFromURL(host.location.href, options.owner);
  // A reload keeps its place in the app's own history.
  track(
    stateEntry(host.history.state) || {
      depth: 0,
      base: 0,
      route: initialRoute,
    },
  );
  const state = {
    ...host.history.state,
    [STATE_KEY]: {
      version: 1,
      owner: options.owner,
      route: initialRoute,
      depth,
      base,
    },
  };
  host.history.replaceState(state, '', host.location.href);
  const ready = transition(initialRoute, 'replace', true);
  return {
    ready,
    navigate(route: AppRoute, navigation: { replace?: boolean } = {}) {
      if (disposed) return Promise.resolve(false);
      if (appRouteKey(route) === appRouteKey(active)) {
        if (pending) {
          generation++;
          pending = false;
          write('replace', active);
        }
        return Promise.resolve(true);
      }
      return transition(route, navigation.replace ? 'replace' : 'push');
    },
    cancelPending,
    /** Returns to the view before the current screen; false when there is none. */
    back() {
      if (disposed || !base) return false;
      host.history.go(base - 1 - depth);
      return true;
    },
    observe(input: AppRoute) {
      observed = normalizeAppRoute(input);
      if (disposed || pending) return;
      const key = appRouteKey(observed);
      if (settling) {
        if (key === settling) settling = '';
        return;
      }
      if (key === appRouteKey(active)) return;
      const typing = active.page === 'search' && observed.page === 'search';
      const renamedProfile =
        active.page === 'profile' &&
        observed.page === 'profile' &&
        !!active.profileId &&
        active.profileId === observed.profileId &&
        active.profileTab === observed.profileTab &&
        active.boost === observed.boost;
      active = observed;
      write(typing || renamedProfile ? 'replace' : 'push', active);
    },
    dispose() {
      disposed = true;
      generation++;
      detach();
    },
  };
}
