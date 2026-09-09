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
  handle?: string;
  peerId?: string;
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
      ...(input.boost ? { boost: true } : {}),
      handle: input.profileId ? '' : text(input.handle, 24).toLowerCase(),
      profileTab: ['posts', 'media', 'gifts'].includes(input.profileTab || '')
        ? input.profileTab
        : 'posts',
    };
  if (page === 'messages') return { page, peerId: text(input.peerId) };
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
      profileId:
        params.get('boost') ||
        params.get('profile') ||
        (params.get('gifts') === '1' ? owner : ''),
      ...(params.get('boost') ? { boost: true } : {}),
      handle: params.get('handle') || '',
      profileTab:
        params.get('gifts') === '1' ? 'gifts' : params.get('tab') || 'posts',
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
    if (route.profileId)
      params.set(route.boost ? 'boost' : 'profile', route.profileId);
    else if (route.handle) params.set('handle', route.handle);
    else params.set('page', 'profile');
    if (route.profileTab !== 'posts') params.set('tab', route.profileTab!);
  } else if (route.page === 'messages') {
    if (route.peerId) params.set('chat', route.peerId);
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
  host: Window,
  options: {
    owner: string;
    initial: AppRoute;
    prepare: (route: AppRoute) => Promise<PreparedRoute>;
    error: (message: string) => void;
  },
) {
  let active = normalizeAppRoute(options.initial),
    observed = active;
  let generation = 0,
    pending = false,
    disposed = false,
    settling = '';
  const stateRoute = (state: unknown) => {
    if (!state || typeof state !== 'object') return null;
    const entry = (state as Record<string, unknown>)[STATE_KEY] as
      | { version?: number; owner?: string; route?: AppRoute }
      | undefined;
    return entry?.version === 1 &&
      entry.owner === options.owner &&
      entry.route &&
      pages.has(entry.route.page)
      ? normalizeAppRoute(entry.route)
      : null;
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
    // Preserve the router's own metadata and any unrelated state fields.
    const state = {
      ...host.history.state,
      [STATE_KEY]: { version: 1, owner: options.owner, route },
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
      active = next;
      settling =
        appRouteKey(observed) === appRouteKey(next) ? '' : appRouteKey(next);
      pending = false;
      write(mode === 'push' && changed ? 'push' : 'replace', next, initial);
      prepared.commit();
      return true;
    } catch (error) {
      if (disposed || generation !== version) return false;
      pending = false;
      settling = '';
      if (mode === 'replace') write('replace', active);
      options.error(
        error instanceof Error ? error.message : 'Не удалось открыть раздел',
      );
      return false;
    }
  };
  const pop = (event: PopStateEvent) => {
    const route = stateRoute(event.state);
    if (!route || !appPaths.has(host.location.pathname)) {
      // A native traversal can unmount the app asynchronously. Prevent an older
      // profile request from rewriting the destination URL in the meantime.
      disposed = true;
      generation++;
      host.removeEventListener('popstate', pop, true);
      return;
    }
    // These entries describe client views in the mounted app. Letting the
    // framework also traverse them would reload the RSC tree and reset the player.
    event.stopImmediatePropagation();
    void transition(route, 'replace');
  };
  host.addEventListener('popstate', pop, true);
  const initialRoute = appRouteFromURL(host.location.href, options.owner);
  const state = {
    ...host.history.state,
    [STATE_KEY]: { version: 1, owner: options.owner, route: initialRoute },
  };
  host.history.replaceState(state, '', host.location.href);
  const ready = transition(initialRoute, 'replace', true);
  return {
    ready,
    navigate(route: AppRoute) {
      if (disposed) return Promise.resolve(false);
      if (appRouteKey(route) === appRouteKey(active)) {
        if (pending) {
          generation++;
          pending = false;
          write('replace', active);
        }
        return Promise.resolve(true);
      }
      return transition(route, 'push');
    },
    cancelPending,
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
      active = observed;
      write(typing ? 'replace' : 'push', active);
    },
    dispose() {
      disposed = true;
      generation++;
      host.removeEventListener('popstate', pop, true);
    },
  };
}
