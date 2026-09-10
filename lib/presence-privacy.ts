import { db } from './storage';
import { ApiError } from './api-error';
import { appearanceColumns } from './premium-access';

/** One viewer binding; hidden timestamps never leave the server. */
export function visibleLastSeen(alias: string) {
  if (!/^[a-z]+$/.test(alias)) throw new Error('Invalid SQL alias');
  return `(SELECT CASE WHEN ${alias}.id=pv.viewer OR (
    NOT EXISTS(SELECT 1 FROM user_blocks pb WHERE
      (pb.blocker=${alias}.id AND pb.blocked=pv.viewer) OR
      (pb.blocker=pv.viewer AND pb.blocked=${alias}.id))
    AND CASE COALESCE((SELECT policy FROM user_presence_privacy WHERE userId=${alias}.id),'everyone')
      WHEN 'everyone' THEN NOT EXISTS(SELECT 1 FROM user_presence_exceptions WHERE userId=${alias}.id AND rule='hide' AND viewerId=pv.viewer)
      ELSE EXISTS(SELECT 1 FROM user_presence_exceptions WHERE userId=${alias}.id AND rule='show' AND viewerId=pv.viewer)
    END
  ) THEN ${alias}.lastSeen ELSE NULL END FROM (SELECT ? AS viewer) pv)`;
}

export async function readPresencePrivacy(me: string) {
  const [settings, exceptions] = await Promise.all([
    db()
      .prepare('SELECT policy FROM user_presence_privacy WHERE userId=?')
      .bind(me)
      .first(),
    db()
      .prepare(`SELECT u.id,u.name,u.avatar,${appearanceColumns('u')},h.handle,e.rule
      FROM user_presence_exceptions e JOIN users u ON u.id=e.viewerId
      LEFT JOIN handles h ON h.userId=u.id AND h.main=1
      WHERE e.userId=? AND u.deletedAt=0 ORDER BY u.name,u.id`)
      .bind(me)
      .all(),
  ]);
  return {
    policy: settings?.policy || 'everyone',
    hidden: exceptions.results
      .filter((p) => p.rule === 'hide')
      .map(({ rule: _rule, ...person }) => person),
    visible: exceptions.results
      .filter((p) => p.rule === 'show')
      .map(({ rule: _rule, ...person }) => person),
  };
}
export async function savePresencePrivacy(
  me: string,
  body: Record<string, unknown>,
) {
  if (
    typeof body.policy !== 'string' ||
    !['everyone', 'nobody'].includes(body.policy)
  )
    throw new ApiError(400, 'Выбери, кто видит статус сети');
  const ids = (value: unknown) => {
    if (
      !Array.isArray(value) ||
      value.length > 100 ||
      value.some(
        (id) => typeof id !== 'string' || !id || id.length > 200 || id === me,
      ) ||
      new Set(value).size !== value.length
    )
      throw new ApiError(
        400,
        'Выбери до 100 пользователей в каждом списке исключений',
      );
    return value as string[];
  };
  const hidden = ids(body.hiddenIds),
    visible = ids(body.visibleIds);
  const all = JSON.stringify([...new Set([...hidden, ...visible])]);
  const invalid = await db()
    .prepare(`SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(
    SELECT 1 FROM users u WHERE u.id=j.value AND u.kind='person' AND u.deletedAt=0 AND u.onboardingComplete=1) LIMIT 1`)
    .bind(all)
    .first();
  if (invalid)
    throw new ApiError(400, 'Один из выбранных пользователей недоступен');
  await db().batch([
    db()
      .prepare(`INSERT INTO user_presence_privacy(userId,policy) VALUES(?,?)
      ON CONFLICT(userId) DO UPDATE SET policy=excluded.policy`)
      .bind(me, body.policy),
    db()
      .prepare('DELETE FROM user_presence_exceptions WHERE userId=?')
      .bind(me),
    ...(
      [
        ['hide', hidden],
        ['show', visible],
      ] as const
    ).map(([rule, list]) =>
      db()
        .prepare(`INSERT INTO user_presence_exceptions(userId,viewerId,rule)
        SELECT ?,value,? FROM json_each(?)`)
        .bind(me, rule, JSON.stringify(list)),
    ),
  ]);
  return { ok: true };
}
