import type { Post } from './client';

/** At most one request per key. Values chosen while it runs replace each other
 * and only the last one is sent next, so rapid taps settle on the last tap.
 * The first caller gets the promise for the whole run; later callers join it. */
export function createLatestRequests() {
  const wanted = new Map<string, unknown>();
  return <T>(key: string, value: T, send: (value: T) => Promise<unknown>) => {
    const joined = wanted.has(key);
    wanted.set(key, value);
    if (joined) return undefined;
    return (async () => {
      try {
        let sent: T;
        do {
          sent = wanted.get(key) as T;
          await send(sent);
        } while (!Object.is(wanted.get(key), sent));
      } finally {
        wanted.delete(key);
      }
    })();
  };
}

export type PostChoice = { like?: boolean; save?: boolean; vote?: number };

/** The post as the viewer just chose it, derived from the latest server copy. */
export function choosePost(post: Post, choice: PostChoice): Post {
  let next = post;
  if (choice.like !== undefined && choice.like !== !!post.liked)
    next = {
      ...next,
      liked: choice.like ? 1 : 0,
      likes: Math.max(0, post.likes + (choice.like ? 1 : -1)),
    };
  if (choice.save !== undefined && choice.save !== !!post.saved)
    next = { ...next, saved: choice.save ? 1 : 0 };
  const vote = choice.vote;
  if (vote !== undefined && vote !== post.voted) {
    const votes = post.votes.map((row) => ({
      ...row,
      count: Math.max(
        0,
        row.count -
          (row.option === post.voted ? 1 : 0) +
          (row.option === vote ? 1 : 0),
      ),
    }));
    if (!votes.some((row) => row.option === vote))
      votes.push({ option: vote, count: 1 });
    next = { ...next, voted: vote, votes };
  }
  return next;
}
