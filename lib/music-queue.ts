/** Move one row without changing track identity or touching playback. */
export function moveMusicItem<T>(items: T[], from: number, to: number): T[] {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length ||
    from === to
  )
    return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Next single move that brings `current` towards `wanted`, preferring the row
 * the listener dragged. Null when done or when the rows themselves differ.
 */
export function nextMusicMove(
  current: string[],
  wanted: string[],
  prefer?: string,
) {
  const same = (order: string[]) =>
    order.every((id, index) => id === wanted[index]);
  const rows = new Set(current);
  if (
    current.length !== wanted.length ||
    wanted.some((id) => !rows.has(id)) ||
    same(current)
  )
    return null;
  if (prefer !== undefined) {
    const move = { from: current.indexOf(prefer), to: wanted.indexOf(prefer) };
    if (same(moveMusicItem(current, move.from, move.to))) return move;
  }
  const first = current.findIndex((id, index) => id !== wanted[index]);
  let last = current.length - 1;
  while (current[last] === wanted[last]) last--;
  // Either the first differing row went down, or the row that belongs there came up.
  return same(moveMusicItem(current, first, last))
    ? { from: first, to: last }
    : { from: current.indexOf(wanted[first]), to: first };
}
