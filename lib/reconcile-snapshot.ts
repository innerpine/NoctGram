// JSON API snapshots: keep unchanged rows/branches so polling does not invalidate
// whole lists. Compare every field, including read receipts and permissions.
export function reconcileSnapshot<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (
    !previous ||
    !next ||
    typeof previous !== 'object' ||
    typeof next !== 'object'
  )
    return next;
  if (Array.isArray(previous) && Array.isArray(next)) {
    const byId = new Map(
      previous
        .filter(
          (item) =>
            item && typeof item === 'object' && typeof item.id === 'string',
        )
        .map((item) => [item.id, item]),
    );
    let equal = previous.length === next.length;
    const merged = next.map((item, index) => {
      const old =
        item && typeof item === 'object' && typeof item.id === 'string'
          ? byId.get(item.id)
          : previous[index];
      const value = reconcileSnapshot(old, item);
      if (value !== previous[index]) equal = false;
      return value;
    });
    return (equal ? previous : merged) as T;
  }
  if (Array.isArray(previous) || Array.isArray(next)) return next;
  const old = previous as Record<string, unknown>;
  const data = next as Record<string, unknown>;
  const keys = Object.keys(data);
  let equal = Object.keys(old).length === keys.length;
  const merged = Object.fromEntries(
    keys.map((key) => {
      const value = reconcileSnapshot(old[key], data[key]);
      if (!Object.hasOwn(old, key) || value !== old[key]) equal = false;
      return [key, value];
    }),
  );
  return (equal ? previous : merged) as T;
}
