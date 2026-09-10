import { appearanceColumns, appearanceFrom } from '@/lib/premium-access';
import { db, clean, ApiError } from './server';
import { assertReadable, visibleAccount } from './account-access';
import { messageAllowed } from './privacy';
import { setting } from './auth-session';
import { sqlNow } from './channel-access';
import { turnConfiguration } from './turn';
import { rateLimit } from './rate-limit';

export function callAllowed() {
  return `${messageAllowed} AND s.kind='person' AND r.kind='person' AND s.id<>r.id AND ${visibleAccount('s')} AND ${visibleAccount('r')}
    AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId IN(s.id,r.id) AND (ar.expiresAt IS NULL OR ar.expiresAt>${sqlNow}))`;
}
export async function expireCalls(participants?: string[]) {
  const d = db(),
    now = Date.now();
  const scope = participants
    ? `WITH scoped AS MATERIALIZED (
        SELECT id FROM calls WHERE status<>'ended' AND caller IN(SELECT value FROM json_each(?))
        UNION SELECT id FROM calls WHERE status<>'ended' AND callee IN(SELECT value FROM json_each(?))
      )`
    : '';
  // Reads only inspect the participants' active calls. Global cleanup belongs to jobs.
  const expired = await d
    .prepare(`${scope} SELECT id FROM calls WHERE status<>'ended' ${participants ? 'AND id IN(SELECT id FROM scoped)' : ''}
    AND (expiresAt<? OR (status='accepted' AND (callerSeen<? OR calleeSeen<?))
      OR NOT EXISTS(SELECT 1 FROM users s,users r WHERE s.id=calls.caller AND r.id=calls.callee AND ${callAllowed()})) LIMIT 100`)
    .bind(
      ...(participants
        ? [JSON.stringify(participants), JSON.stringify(participants)]
        : []),
      now,
      now - 90000,
      now - 90000,
    )
    .all<{ id: string }>();
  if (expired.results.length) {
    const ids = JSON.stringify(expired.results.map((row) => row.id));
    await d.batch([
      d
        .prepare(`UPDATE calls SET status='ended',reason=CASE WHEN status='ringing' THEN 'missed' ELSE 'disconnected' END,endedAt=?,offer=NULL,answer=NULL
        WHERE id IN(SELECT value FROM json_each(?)) AND status<>'ended'
        AND (expiresAt<? OR (status='accepted' AND (callerSeen<? OR calleeSeen<?))
          OR NOT EXISTS(SELECT 1 FROM users s,users r WHERE s.id=calls.caller AND r.id=calls.callee AND ${callAllowed()}))`)
        .bind(now, ids, now, now - 90000, now - 90000),
      d
        .prepare(
          "DELETE FROM call_signals WHERE callId IN(SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM calls c WHERE c.id=call_signals.callId AND c.status='ended')",
        )
        .bind(ids),
    ]);
  }
  if (!participants) {
    await d.batch([
      d
        .prepare(
          'DELETE FROM call_cancellations WHERE callId IN(SELECT callId FROM call_cancellations WHERE created<? ORDER BY created LIMIT 1000)',
        )
        .bind(now - 300000),
      d.prepare(
        "DELETE FROM call_signals WHERE id IN(SELECT cs.id FROM call_signals cs JOIN calls c ON c.id=cs.callId WHERE c.status='ended' LIMIT 1000)",
      ),
    ]);
  }
}
function device(value: unknown) {
  const v = clean(value, 80, true);
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(v))
    throw new ApiError(400, 'Неверный идентификатор устройства');
  return v;
}
const ownsDevice = `( (caller=? AND callerDevice=?) OR (callee=? AND calleeDevice=?) )`;
export async function callsGet(
  action: string,
  s: URLSearchParams,
  me: string,
): Promise<Response | null> {
  if (!['callState', 'callConfig'].includes(action)) return null;
  const client = device(s.get('device'));
  const id = clean(s.get('id') || '', 100, action === 'callConfig');
  await rateLimit('call-read', me, 180, 60);
  await assertReadable(me);
  await expireCalls([me]);
  if (action === 'callConfig') {
    const eligible = () =>
      db()
        .prepare(
          `SELECT id FROM calls WHERE id=? AND status='accepted' AND expiresAt>? AND ${ownsDevice} AND EXISTS(SELECT 1 FROM users s,users r WHERE s.id=calls.caller AND r.id=calls.callee AND ${callAllowed()})`,
        )
        .bind(id, Date.now(), me, client, me, client)
        .first();
    if (!(await eligible())) throw new ApiError(403, 'Звонок недоступен');
    await rateLimit('turn-config', me, 8, 60);
    const config = await turnConfiguration(setting);
    if (!(await eligible())) throw new ApiError(403, 'Звонок уже завершён');
    return Response.json(config, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const row = await db()
    .prepare(
      `SELECT c.*,u.name,u.avatar,${appearanceColumns('u')},h.handle FROM calls c JOIN users u ON u.id=CASE WHEN c.caller=? THEN c.callee ELSE c.caller END LEFT JOIN handles h ON h.userId=u.id AND h.main=1 WHERE (c.caller=? OR c.callee=?) AND ${id ? 'c.id=?' : "c.status<>'ended'"} AND (c.status='ended' OR EXISTS(SELECT 1 FROM users s,users r WHERE s.id=c.caller AND r.id=c.callee AND ${callAllowed()})) ORDER BY c.created DESC LIMIT 1`,
    )
    .bind(me, me, me, ...(id ? [id] : []))
    .first();
  if (!row) return Response.json({ call: null, signals: [] });
  const own =
    row.caller === me
      ? row.callerDevice === client
      : row.calleeDevice === client;
  if (own && row.status !== 'ended')
    await db()
      .prepare(
        `UPDATE calls SET ${row.caller === me ? 'callerSeen' : 'calleeSeen'}=? WHERE id=? AND ${ownsDevice}`,
      )
      .bind(Date.now(), row.id, me, client, me, client)
      .run();
  const signals =
    own && row.status === 'accepted'
      ? (
          await db()
            .prepare(
              `SELECT id,candidate,negotiation FROM call_signals WHERE callId=? AND sender<>? AND id>? AND EXISTS(SELECT 1 FROM calls c,users s,users r WHERE c.id=call_signals.callId AND c.status='accepted' AND s.id=c.caller AND r.id=c.callee AND ${callAllowed()}) ORDER BY id LIMIT 100`,
            )
            .bind(row.id, me, Math.max(0, Number(s.get('after')) || 0))
            .all()
        ).results
      : [];
  return Response.json({
    call: {
      ...appearanceFrom(row),
      id: row.id,
      caller: row.caller,
      callee: row.callee,
      status: row.status,
      reason: row.reason,
      created: row.created,
      acceptedAt: row.acceptedAt,
      negotiation: row.negotiation,
      restartRequested: row.restartRequested,
      name: row.name,
      avatar: row.avatar,
      handle: row.handle,
      deviceOwned: own,
      ...(own && row.status === 'accepted'
        ? { offer: row.offer, answer: row.answer }
        : {}),
    },
    signals,
  });
}
export async function callsPost(
  action: string,
  b: Record<string, unknown>,
  me: string,
): Promise<Response | null> {
  if (!['callStart', 'callAccept', 'callSignal', 'callEnd'].includes(action))
    return null;
  const id = clean(b.id, 100, true),
    client = device(b.device),
    d = db(),
    now = Date.now();
  if (action === 'callEnd') {
    const reason = [
      'declined',
      'cancelled',
      'completed',
      'failed',
      'disconnected',
    ].includes(String(b.reason))
      ? String(b.reason)
      : 'completed';
    const r = await d.batch([
      d
        .prepare(
          `UPDATE calls SET status='ended',reason=?,endedAt=?,offer=NULL,answer=NULL WHERE id=? AND status<>'ended' AND (${ownsDevice} OR (callee=? AND status='ringing'))`,
        )
        .bind(reason, now, id, me, client, me, client, me),
      d
        .prepare(
          "DELETE FROM call_signals WHERE callId=? AND EXISTS(SELECT 1 FROM calls WHERE id=? AND status='ended' AND (caller=? OR callee=?))",
        )
        .bind(id, id, me, me),
      d
        .prepare('DELETE FROM call_cancellations WHERE caller=? AND created<?')
        .bind(me, now - 300000),
      // Cancel can reach the server before its in-flight callStart. Keep a short,
      // device-bound record so that a delayed request cannot ring the peer later.
      d
        .prepare(`INSERT OR IGNORE INTO call_cancellations(callId,caller,device,created)
        SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM calls WHERE id=?)
        AND (SELECT COUNT(*) FROM call_cancellations WHERE caller=?)<100`)
        .bind(id, me, client, now, id, me),
    ]);
    if (
      !r[0].meta.changes &&
      !(await d
        .prepare(
          "SELECT id FROM calls WHERE id=? AND status='ended' AND (caller=? OR callee=?)",
        )
        .bind(id, me, me)
        .first()) &&
      !(await d
        .prepare(
          'SELECT callId FROM call_cancellations WHERE callId=? AND caller=? AND device=? AND NOT EXISTS(SELECT 1 FROM calls WHERE id=?)',
        )
        .bind(id, me, client, id)
        .first())
    )
      throw new ApiError(403, 'Звонок недоступен');
    return Response.json({ ok: true });
  }
  await assertReadable(me);
  await expireCalls(
    action === 'callStart' ? [me, clean(b.peer, 200, true)] : [me],
  );
  if (action === 'callStart') {
    const peer = clean(b.peer, 200, true);
    const existing = await d
      .prepare(
        'SELECT id FROM calls WHERE id=? AND caller=? AND callee=? AND callerDevice=?',
      )
      .bind(id, me, peer, client)
      .first();
    if (existing) return Response.json({ ok: true, id });
    const rows = await d.batch([
      d
        .prepare(`INSERT OR IGNORE INTO calls(id,caller,callee,callerDevice,created,callerSeen,calleeSeen,expiresAt) SELECT ?,s.id,r.id,?,?,?,?,? FROM users s,users r WHERE s.id=? AND r.id=? AND ${callAllowed()}
        AND NOT EXISTS(SELECT 1 FROM calls WHERE status<>'ended' AND (caller IN(s.id,r.id) OR callee IN(s.id,r.id)))
        AND NOT EXISTS(SELECT 1 FROM call_cancellations WHERE callId=? AND caller=s.id AND device=?)
        AND (SELECT COUNT(*) FROM calls WHERE caller=s.id AND created>?)<5`)
        .bind(
          id,
          client,
          now,
          now,
          now,
          now + 60000,
          me,
          peer,
          id,
          client,
          now - 60000,
        ),
      d
        .prepare(
          "INSERT OR IGNORE INTO notifications(id,userId,actorId,kind,targetId,created) SELECT ?,callee,caller,'call',id,created FROM calls WHERE id=? AND caller=? AND callerDevice=? AND status='ringing'",
        )
        .bind('call:' + id, id, me, client),
    ]);
    if (!rows[0].meta.changes)
      throw new ApiError(
        409,
        'Абонент занят, звонки ограничены или слишком много попыток',
      );
    return Response.json({ ok: true, id });
  }
  if (action === 'callAccept') {
    const r = await d
      .prepare(
        `UPDATE calls SET status='accepted',calleeDevice=?,acceptedAt=COALESCE(acceptedAt,?),calleeSeen=?,expiresAt=CASE WHEN status='ringing' THEN ? ELSE expiresAt END WHERE id=? AND callee=? AND (status='ringing' OR (status='accepted' AND calleeDevice=?)) AND expiresAt>? AND EXISTS(SELECT 1 FROM users s,users r WHERE s.id=calls.caller AND r.id=calls.callee AND ${callAllowed()})`,
      )
      .bind(client, now, now, now + 7200000, id, me, client, now)
      .run();
    if (!r.meta.changes)
      throw new ApiError(
        409,
        'Звонок уже завершён или принят на другом устройстве',
      );
    return Response.json({ ok: true });
  }
  const type = clean(b.type, 10, true);
  // Older clients may complete their first negotiation, but cannot overwrite a restart.
  const negotiation = b.negotiation === undefined ? 1 : b.negotiation;
  if (
    typeof negotiation !== 'number' ||
    !Number.isInteger(negotiation) ||
    negotiation < 1 ||
    negotiation > 1000
  )
    throw new ApiError(400, 'Неверная версия соединения');
  if (type === 'restart') {
    const r = await d
      .prepare(
        `UPDATE calls SET restartRequested=? WHERE id=? AND callee=? AND calleeDevice=? AND status='accepted' AND negotiation=? AND EXISTS(SELECT 1 FROM users s,users r WHERE s.id=calls.caller AND r.id=calls.callee AND ${callAllowed()})`,
      )
      .bind(negotiation, id, me, client, negotiation)
      .run();
    if (!r.meta.changes) throw new ApiError(409, 'Состояние звонка изменилось');
  } else if (type === 'offer' || type === 'answer') {
    const sdp = clean(b.sdp, 20000, true).replace(/\r?\n/g, '\r\n') + '\r\n';
    if (
      !sdp.startsWith('v=0\r\n') ||
      (sdp.match(/^m=audio /gm) || []).length !== 1 ||
      /^m=(?!audio )/m.test(sdp)
    )
      throw new ApiError(400, 'Неверное описание соединения');
    const role = type === 'offer' ? 'caller' : 'callee';
    const r =
      type === 'offer'
        ? await d
            .prepare(
              `UPDATE calls SET answer=CASE WHEN negotiation=? THEN answer ELSE NULL END,restartRequested=CASE WHEN negotiation=? THEN restartRequested ELSE 0 END,offer=?,negotiation=? WHERE id=? AND caller=? AND callerDevice=? AND status='accepted' AND (negotiation=? OR (negotiation=? AND offer=?)) AND EXISTS(SELECT 1 FROM users s,users r WHERE s.id=calls.caller AND r.id=calls.callee AND ${callAllowed()})`,
            )
            .bind(
              negotiation,
              negotiation,
              sdp,
              negotiation,
              id,
              me,
              client,
              negotiation - 1,
              negotiation,
              sdp,
            )
            .run()
        : await d
            .prepare(
              `UPDATE calls SET answer=? WHERE id=? AND ${role}=? AND ${role}Device=? AND status='accepted' AND negotiation=? AND offer IS NOT NULL AND (answer IS NULL OR answer=?) AND EXISTS(SELECT 1 FROM users s,users r WHERE s.id=calls.caller AND r.id=calls.callee AND ${callAllowed()})`,
            )
            .bind(sdp, id, me, client, negotiation, sdp)
            .run();
    if (!r.meta.changes) throw new ApiError(409, 'Состояние звонка изменилось');
  } else if (type === 'ice') {
    if (!Array.isArray(b.candidates) || b.candidates.length > 20)
      throw new ApiError(400, 'Неверные сетевые кандидаты');
    const call = await d
      .prepare(
        `SELECT id,negotiation FROM calls WHERE id=? AND status='accepted' AND ${ownsDevice}`,
      )
      .bind(id, me, client, me, client)
      .first();
    if (!call) throw new ApiError(403, 'Звонок недоступен');
    if (call.negotiation !== negotiation)
      throw new ApiError(409, 'Версия соединения изменилась');
    const validated = (b.candidates as unknown[]).map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        throw new ApiError(400, 'Неверный сетевой кандидат');
      const c = entry as Record<string, unknown>;
      const key = clean(c.key, 100, true);
      const candidate = c.candidate as Record<string, unknown>;
      if (
        !candidate ||
        typeof candidate.candidate !== 'string' ||
        candidate.candidate.length > 2000 ||
        (candidate.sdpMid !== null && typeof candidate.sdpMid !== 'string') ||
        (candidate.sdpMLineIndex !== null &&
          !Number.isInteger(candidate.sdpMLineIndex))
      )
        throw new ApiError(400, 'Неверный сетевой кандидат');
      if (
        (typeof candidate.sdpMid === 'string' &&
          candidate.sdpMid.length > 100) ||
        (typeof candidate.sdpMLineIndex === 'number' &&
          (candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 65535)) ||
        (candidate.sdpMid === null && candidate.sdpMLineIndex === null)
      )
        throw new ApiError(400, 'Неверный сетевой кандидат');
      if (
        candidate.usernameFragment != null &&
        (typeof candidate.usernameFragment !== 'string' ||
          candidate.usernameFragment.length > 256)
      )
        throw new ApiError(400, 'Неверное поколение ICE');
      const data = JSON.stringify({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        usernameFragment: candidate.usernameFragment ?? null,
      });
      return { key, data };
    });
    for (const { key, data } of validated) {
      const inserted = await d
        .prepare(
          `INSERT OR IGNORE INTO call_signals(callId,sender,key,candidate,negotiation) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM calls WHERE id=? AND status='accepted' AND negotiation=? AND ${ownsDevice} AND EXISTS(SELECT 1 FROM users s,users r WHERE s.id=calls.caller AND r.id=calls.callee AND ${callAllowed()})) AND (SELECT COUNT(*) FROM call_signals WHERE callId=? AND sender=? AND negotiation=?)<200`,
        )
        .bind(
          id,
          me,
          key,
          data,
          negotiation,
          id,
          negotiation,
          me,
          client,
          me,
          client,
          id,
          me,
          negotiation,
        )
        .run();
      if (
        !inserted.meta.changes &&
        !(await d
          .prepare(
            'SELECT id FROM call_signals WHERE callId=? AND sender=? AND key=? AND negotiation=?',
          )
          .bind(id, me, key, negotiation)
          .first())
      )
        throw new ApiError(
          409,
          'Версия соединения изменилась или очередь кандидатов заполнена',
        );
    }
  } else throw new ApiError(400, 'Неверный сигнал');
  return Response.json({ ok: true });
}
