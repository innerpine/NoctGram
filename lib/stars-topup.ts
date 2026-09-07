export type TopupCursor = { count: number; total: number };

// Cumulative server totals include credits beyond the paginated history and
// stay independent of spending or support received from other users.
export function observeTopups(
  previous: TopupCursor | null,
  next: { topupCount: number; topupTotal: number },
) {
  const cursor = { count: next.topupCount, total: next.topupTotal };
  const amount =
    previous && cursor.count > previous.count
      ? Math.max(0, cursor.total - previous.total)
      : 0;
  return {
    cursor,
    amount,
    id: `${cursor.count}:${cursor.total}`,
  };
}
