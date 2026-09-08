import type { Post } from './client';

export type FeedSnapshot = { key: string; posts: Post[]; hasMore: boolean };
export function feedKey(
  owner: string,
  page: string,
  mode: string,
  query: string,
  profile = '',
  tab = '',
  privacy = 0,
) {
  return JSON.stringify([
    owner,
    privacy,
    page,
    page === 'feed' ? mode : '',
    query,
    page === 'profile' ? profile : '',
    page === 'profile' ? tab : '',
  ]);
}
export function sameSearch(a: string, b: string) {
  if (!a || !b) return false;
  const left = JSON.parse(a),
    right = JSON.parse(b);
  return (
    left[0] === right[0] &&
    left[1] === right[1] &&
    left[2] === 'search' &&
    right[2] === 'search'
  );
}
export function createFeedSnapshots() {
  const cache = new Map<string, FeedSnapshot>();
  let scope = '';
  return {
    reset(owner: string, privacy: number) {
      const next = JSON.stringify([owner, privacy]);
      if (scope !== next) {
        scope = next;
        cache.clear();
      }
    },
    get: (key: string) => cache.get(key),
    clear: () => cache.clear(),
    remove(id: string) {
      for (const [key, snapshot] of cache) {
        if (snapshot.posts.some((post) => post.id === id))
          cache.set(key, {
            ...snapshot,
            posts: snapshot.posts.filter((post) => post.id !== id),
          });
      }
    },
    update(post: Post) {
      for (const [key, snapshot] of cache) {
        if (snapshot.posts.some((item) => item.id === post.id))
          cache.set(key, {
            ...snapshot,
            posts: snapshot.posts.map((item) =>
              item.id === post.id ? post : item,
            ),
          });
      }
    },
    save(snapshot: FeedSnapshot) {
      if (!snapshot.key) return;
      const [owner, privacy, page] = JSON.parse(snapshot.key);
      if (
        JSON.stringify([owner, privacy]) !== scope ||
        !['feed', 'search'].includes(page)
      )
        return;
      cache.delete(snapshot.key);
      cache.set(snapshot.key, snapshot);
      if (cache.size > 8) cache.delete(cache.keys().next().value!);
    },
  };
}
