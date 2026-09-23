/** Session-only, bounded cache for profile covers. Private attachments keep their
 * normal access checks; nothing is persisted in browser storage or shared caches. */
export function createProfileCoverCache() {
  type Cover = { src: string; image: HTMLImageElement; bytes: number };
  const covers = new Map<string, Cover>();
  const pending = new Map<
    string,
    { controller: AbortController; promise: Promise<string | undefined> }
  >();
  let scope = '',
    generation = 0;
  const release = (url: string) => {
    const entry = covers.get(url);
    if (entry) URL.revokeObjectURL(entry.src);
    covers.delete(url);
  };
  const clear = () => {
    generation++;
    pending.forEach((entry) => entry.controller.abort());
    pending.clear();
    [...covers.keys()].forEach(release);
  };
  const get = (url: string) => {
    const entry = covers.get(url);
    if (!entry) return undefined;
    covers.delete(url);
    covers.set(url, entry);
    return entry.src;
  };
  return {
    reset(next: string) {
      if (scope !== next) {
        clear();
        scope = next;
      }
    },
    clear,
    get,
    loading: (url: string) => pending.has(url),
    prepare(url: string): Promise<string | undefined> {
      if (!scope || !url.startsWith('/api/media/'))
        return Promise.resolve(undefined);
      const cached = get(url);
      if (cached) return Promise.resolve(cached);
      const loading = pending.get(url);
      if (loading) return loading.promise;
      const version = generation,
        controller = new AbortController();
      const promise = (async () => {
        let src = '';
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(url, {
            credentials: 'same-origin',
            signal: controller.signal,
          });
          if (
            !response.ok ||
            !response.headers.get('content-type')?.startsWith('image/') ||
            Number(response.headers.get('content-length')) > 8 * 1024 * 1024
          ) {
            await response.body?.cancel();
            return undefined;
          }
          const blob = await response.blob();
          if (blob.size > 8 * 1024 * 1024 || generation !== version)
            return undefined;
          src = URL.createObjectURL(blob);
          const image = new Image();
          image.src = src;
          await image.decode();
          if (generation !== version || controller.signal.aborted)
            return undefined;
          const bytes = Math.max(
            blob.size,
            image.naturalWidth * image.naturalHeight * 4,
          );
          if (bytes > 32 * 1024 * 1024) return undefined;
          while (
            covers.size >= 8 ||
            [...covers.values()].reduce((n, cover) => n + cover.bytes, bytes) >
              32 * 1024 * 1024
          )
            release(covers.keys().next().value!);
          covers.set(url, { src, image, bytes });
          const ready = src;
          src = '';
          return ready;
        } catch {
          return undefined;
        } finally {
          clearTimeout(timeout);
          if (src) URL.revokeObjectURL(src);
          if (generation === version) pending.delete(url);
        }
      })();
      pending.set(url, { controller, promise });
      return promise;
    },
  };
}
