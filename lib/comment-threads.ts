type ThreadComment = {
  id: string;
  created: number;
  replyTo?: string | null;
};

/** Keep each conversation together without discarding replies to unloaded parents. */
export function commentThreads<T extends ThreadComment>(
  comments: readonly T[],
) {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const ordered = [...byId.values()].sort(
    (a, b) => a.created - b.created || a.id.localeCompare(b.id),
  );
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const comment of ordered) {
    if (
      comment.replyTo &&
      comment.replyTo !== comment.id &&
      byId.has(comment.replyTo)
    ) {
      const siblings = children.get(comment.replyTo);
      if (siblings) siblings.push(comment);
      else children.set(comment.replyTo, [comment]);
    } else roots.push(comment);
  }

  const rows: { comment: T; depth: number }[] = [];
  const visited = new Set<string>();
  const visit = (root: T) => {
    const pending = [{ comment: root, depth: 0 }];
    while (pending.length) {
      const row = pending.pop()!;
      if (visited.has(row.comment.id)) continue;
      visited.add(row.comment.id);
      rows.push(row);
      const replies = children.get(row.comment.id) ?? [];
      for (let i = replies.length - 1; i >= 0; i--) {
        pending.push({ comment: replies[i], depth: row.depth + 1 });
      }
    }
  };
  for (const root of roots) visit(root);
  // Defensive fallback for malformed cycles; every loaded comment stays readable.
  for (const comment of ordered) {
    if (!visited.has(comment.id)) visit(comment);
  }
  return rows;
}
