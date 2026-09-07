import { db } from './storage';
import { ApiError } from './api-error';
import { viewer, clean } from './server';
import {
  authCookie,
  cookieValue,
  tokenHash,
  randomToken,
  SESSION_COOKIE,
  CHALLENGE_COOKIE,
  SESSION_SECONDS,
} from './auth-session';
import { limit, clientIp, emailAddress } from './email-auth';
import { sendEmailCode, verifyEmailCode } from './email-provider';
import { storageUsage } from './upload-storage';
import { deleteAccount } from './account-removal';

type Session = {
  userId: string;
  tokenHash: string;
  verifiedAt: number;
  expiresAt: number;
};
async function session(req: Request, fresh = false) {
  const token = cookieValue(req.headers.get('cookie'), SESSION_COOKIE);
  const row = await db()
    .prepare(
      `SELECT s.* FROM auth_sessions s JOIN users u ON u.id=s.userId WHERE s.tokenHash=? AND s.expiresAt>? AND u.deletedAt=0`,
    )
    .bind(await tokenHash(token), Date.now())
    .first<Session>();
  if (!row)
    throw new ApiError(401, 'Войдите через почту, чтобы управлять аккаунтом.');
  if (fresh && row.verifiedAt < Date.now() - 300000)
    throw new ApiError(
      403,
      'Сначала подтвердите доступ к аккаунту кодом из письма.',
      'REAUTH_REQUIRED',
    );
  return row;
}
const live = `EXISTS(SELECT 1 FROM auth_sessions s JOIN users u ON u.id=s.userId WHERE s.tokenHash=? AND s.userId=? AND s.expiresAt>? AND u.deletedAt=0)`;
export function revokeDevices(
  me: string,
  keep = '',
  condition = '1',
  bindings: (string | number)[] = [],
): D1PreparedStatement[] {
  const d = db();
  const ids = [me, ...bindings];
  return [
    d
      .prepare(
        `DELETE FROM auth_sessions WHERE userId=? AND tokenHash<>? AND (${condition})`,
      )
      .bind(me, keep, ...bindings),
    d
      .prepare(
        `DELETE FROM account_challenges WHERE userId=? AND (${condition})`,
      )
      .bind(...ids),
    d
      .prepare(
        `DELETE FROM auth_challenges WHERE (linkUserId=? OR email IN(SELECT email FROM auth_identities WHERE userId=?)) AND (${condition})`,
      )
      .bind(me, me, ...bindings),
    d
      .prepare(
        `DELETE FROM push_subscriptions WHERE userId=? AND (${condition})`,
      )
      .bind(...ids),
    d
      .prepare(
        `UPDATE calls SET status='ended',reason='completed',endedAt=?,offer=NULL,answer=NULL WHERE (caller=? OR callee=?) AND (${condition})`,
      )
      .bind(Date.now(), me, me, ...bindings),
    d
      .prepare(
        `DELETE FROM call_signals WHERE callId IN(SELECT id FROM calls WHERE caller=? OR callee=?) AND (${condition})`,
      )
      .bind(me, me, ...bindings),
  ];
}
function signedOut(req: Request) {
  const response = Response.json({ ok: true, redirectTo: '/login' });
  // Keep an invalid marker to prevent fallback to a platform identity in this browser.
  response.headers.append(
    'Set-Cookie',
    authCookie(req, SESSION_COOKIE, 'signed-out', SESSION_SECONDS),
  );
  response.headers.append(
    'Set-Cookie',
    authCookie(req, CHALLENGE_COOKIE, '', 0),
  );
  return response;
}
export async function accountStatus(req: Request) {
  const me = await viewer(true),
    d = db();
  const current = cookieValue(req.headers.get('cookie'), SESSION_COOKIE);
  const hash = await tokenHash(current);
  const email = await d
    .prepare('SELECT email FROM auth_identities WHERE userId=?')
    .bind(me)
    .first<{ email: string }>();
  const auth = await d
    .prepare(
      'SELECT verifiedAt FROM auth_sessions WHERE tokenHash=? AND userId=? AND expiresAt>?',
    )
    .bind(hash, me, Date.now())
    .first<{ verifiedAt: number }>();
  const count = await d
    .prepare(
      'SELECT COUNT(*) AS count FROM auth_sessions WHERE userId=? AND expiresAt>?',
    )
    .bind(me, Date.now())
    .first();
  const codes = await d
    .prepare(
      'SELECT COUNT(*) AS count FROM recovery_codes WHERE userId=? AND expiresAt>?',
    )
    .bind(me, Date.now())
    .first();
  const channels = await d
    .prepare(
      'SELECT u.name,h.handle FROM users u LEFT JOIN handles h ON h.userId=u.id AND h.main=1 WHERE u.ownerId=? AND u.deletedAt=0',
    )
    .bind(me)
    .all();
  return {
    email: email?.email || null,
    emailSession: !!auth,
    verifiedUntil: auth ? auth.verifiedAt + 300000 : 0,
    sessions: count?.count || 0,
    recoveryCodes: codes?.count || 0,
    channels: channels.results,
    storage: await storageUsage(me),
  };
}
export async function accountAction(
  req: Request,
  action: string,
  b: Record<string, unknown>,
) {
  if (action === 'recover') return recover(req, b);
  if (action === 'logout-all') {
    const me = (await session(req)).userId;
    await db().batch([
      db()
        .prepare('UPDATE users SET sessionsRevokedAt=? WHERE id=?')
        .bind(Date.now(), me),
      ...revokeDevices(me),
    ]);
    return signedOut(req);
  }
  const s = await session(req),
    d = db(),
    now = Date.now();
  if (action === 'reauth-start' || action === 'email-change-start') {
    if (action === 'email-change-start') await session(req, true);
    const original = await d
      .prepare('SELECT subject,email FROM auth_identities WHERE userId=?')
      .bind(s.userId)
      .first<{ subject: string; email: string }>();
    if (!original) throw new ApiError(409, 'Сначала привяжите почту.');
    const email =
      action === 'reauth-start' ? original.email : emailAddress(b.email);
    if (action === 'email-change-start' && email === original.email)
      throw new ApiError(400, 'Укажите новый адрес.');
    await limit('send-ip', clientIp(req), 20, 3600);
    await limit('send-email', email, 5, 3600);
    await limit('resend', email, 1, 60);
    await sendEmailCode(email);
    const id = randomToken();
    const started = await d.batch([
      d
        .prepare('DELETE FROM account_challenges WHERE sessionHash=?')
        .bind(s.tokenHash),
      d
        .prepare(
          `INSERT INTO account_challenges(id,sessionHash,userId,purpose,subject,email,created,expiresAt) SELECT ?,?,?,?,?,?,?,? WHERE ${live}`,
        )
        .bind(
          id,
          s.tokenHash,
          s.userId,
          action,
          original.subject,
          email,
          now,
          now + 300000,
          s.tokenHash,
          s.userId,
          Date.now(),
        ),
    ]);
    if (!started[1].meta.changes)
      throw new ApiError(409, 'Сессия отозвана. Войдите заново.');
    return Response.json({
      challengeId: id,
      email,
      expiresAt: now + 300000,
      resendAt: now + 60000,
    });
  }
  if (action === 'reauth-verify' || action === 'email-change-verify') {
    const id = clean(b.challengeId, 64, true),
      code = clean(b.code, 6, true);
    if (!/^\d{6}$/.test(code))
      throw new ApiError(400, 'Введите шесть цифр из письма.');
    await limit('verify-ip', clientIp(req), 60, 600);
    const purpose =
      action === 'reauth-verify' ? 'reauth-start' : 'email-change-start';
    const challenge = await d
      .prepare(
        `UPDATE account_challenges SET attempts=attempts+1 WHERE id=? AND sessionHash=? AND userId=? AND purpose=? AND expiresAt>? AND attempts<5 RETURNING email,subject`,
      )
      .bind(id, s.tokenHash, s.userId, purpose, now)
      .first<{ email: string; subject: string }>();
    if (!challenge)
      throw new ApiError(400, 'Подтверждение истекло. Запросите код заново.');
    await limit('verify-email', challenge.email, 10, 600);
    const proof = await verifyEmailCode(challenge.email, code);
    const gate = `${live} AND EXISTS(SELECT 1 FROM account_challenges c WHERE c.id=? AND c.sessionHash=? AND c.expiresAt>?) AND EXISTS(SELECT 1 FROM auth_identities WHERE userId=? AND subject=?)`;
    const args = [
      s.tokenHash,
      s.userId,
      Date.now(),
      id,
      s.tokenHash,
      Date.now(),
      s.userId,
      challenge.subject,
    ];
    if (action === 'reauth-verify') {
      if (proof.subject !== challenge.subject)
        throw new ApiError(409, 'Привязка почты изменилась.');
      const results = await d.batch([
        d
          .prepare(
            `UPDATE auth_sessions SET verifiedAt=? WHERE tokenHash=? AND ${gate}`,
          )
          .bind(Date.now(), s.tokenHash, ...args),
        d
          .prepare(
            'DELETE FROM account_challenges WHERE id=? AND sessionHash=?',
          )
          .bind(id, s.tokenHash),
      ]);
      if (!results[0].meta.changes)
        throw new ApiError(409, 'Сессия изменилась. Войдите заново.');
      return Response.json({ ok: true, verifiedUntil: Date.now() + 300000 });
    }
    // New-email proof never substitutes for fresh proof of the current account.
    const freshGate = `${gate} AND EXISTS(SELECT 1 FROM auth_sessions WHERE tokenHash=? AND verifiedAt>?)`;
    const freshArgs = [...args, s.tokenHash, Date.now() - 300000];
    const success = `EXISTS(SELECT 1 FROM auth_identities WHERE userId=? AND subject=?) AND ${live}`;
    const successArgs = [
      s.userId,
      proof.subject,
      s.tokenHash,
      s.userId,
      Date.now(),
    ];
    try {
      const result = await d.batch([
        d
          .prepare(
            `UPDATE auth_identities SET subject=?,email=? WHERE userId=? AND ${freshGate}`,
          )
          .bind(proof.subject, proof.email, s.userId, ...freshArgs),
        d
          .prepare(
            `UPDATE users SET sessionsRevokedAt=? WHERE id=? AND (${success})`,
          )
          .bind(Date.now(), s.userId, ...successArgs),
        ...revokeDevices(s.userId, s.tokenHash, success, successArgs),
        d
          .prepare(`DELETE FROM recovery_codes WHERE userId=? AND (${success})`)
          .bind(s.userId, ...successArgs),
      ]);
      if (!result[0].meta.changes)
        throw new ApiError(
          409,
          'Подтверждение истекло. Начните смену почты заново.',
        );
    } catch (e) {
      if (String(e).includes('UNIQUE'))
        throw new ApiError(409, 'Эта почта уже привязана к другому аккаунту.');
      throw e;
    }
    return Response.json({ ok: true, email: proof.email });
  }
  if (action === 'recovery-codes') {
    await session(req, true);
    await limit('recovery-create', s.userId, 5, 3600);
    const codes = Array.from({ length: 8 }, () =>
      randomToken()
        .slice(0, 32)
        .match(/.{1,4}/g)!
        .join('-'),
    );
    const gate = `${live} AND EXISTS(SELECT 1 FROM auth_sessions WHERE tokenHash=? AND verifiedAt>?)`;
    const args = [
      s.tokenHash,
      s.userId,
      Date.now(),
      s.tokenHash,
      Date.now() - 300000,
    ];
    const statements = [
      d
        .prepare(`DELETE FROM recovery_codes WHERE userId=? AND ${gate}`)
        .bind(s.userId, ...args),
    ];
    for (const code of codes)
      statements.push(
        d
          .prepare(
            `INSERT INTO recovery_codes(hash,userId,created,expiresAt) SELECT ?,?,?,? WHERE ${gate}`,
          )
          .bind(
            await tokenHash(code.replaceAll('-', '')),
            s.userId,
            now,
            now + 365 * 86400000,
            ...args,
          ),
      );
    const results = await d.batch(statements);
    if (!results[1].meta.changes)
      throw new ApiError(409, 'Подтверждение истекло.');
    return Response.json({ codes, expiresAt: now + 365 * 86400000 });
  }
  if (action === 'delete-account') {
    await session(req, true);
    if (b.confirm !== 'УДАЛИТЬ')
      throw new ApiError(400, 'Введите УДАЛИТЬ для подтверждения.');
    await deleteAccount(s.userId, s.tokenHash, b.deleteChannels === true);
    return signedOut(req);
  }
  throw new ApiError(404, 'Не найдено');
}
async function recover(req: Request, b: Record<string, unknown>) {
  await limit('recovery-ip', clientIp(req), 10, 3600);
  const code = clean(b.code, 80, true)
    .toLowerCase()
    .replaceAll('-', '')
    .replaceAll(' ', '');
  if (!/^[a-f0-9]{32}$/.test(code))
    throw new ApiError(
      400,
      'Резервный код недействителен или уже использован.',
    );
  const hash = await tokenHash(code),
    token = randomToken(),
    nextHash = await tokenHash(token),
    now = Date.now(),
    d = db();
  const owner = await d
    .prepare('SELECT userId FROM recovery_codes WHERE hash=? AND expiresAt>?')
    .bind(hash, now)
    .first<{ userId: string }>();
  if (!owner)
    throw new ApiError(
      400,
      'Резервный код недействителен или уже использован.',
    );
  const success = 'EXISTS(SELECT 1 FROM auth_sessions WHERE tokenHash=?)';
  const results = await d.batch([
    d
      .prepare(
        `INSERT INTO auth_sessions(tokenHash,userId,created,expiresAt,verifiedAt) SELECT ?,r.userId,?,?,? FROM recovery_codes r JOIN users u ON u.id=r.userId WHERE r.hash=? AND r.expiresAt>? AND u.deletedAt=0`,
      )
      .bind(nextHash, now, now + SESSION_SECONDS * 1000, now, hash, now),
    d
      .prepare(`DELETE FROM recovery_codes WHERE hash=? AND ${success}`)
      .bind(hash, nextHash),
    d
      .prepare(`UPDATE users SET sessionsRevokedAt=? WHERE id=? AND ${success}`)
      .bind(now, owner.userId, nextHash),
    ...revokeDevices(owner.userId, nextHash, success, [nextHash]),
  ]);
  if (!results[0].meta.changes)
    throw new ApiError(
      400,
      'Резервный код недействителен или уже использован.',
    );
  return Response.json(
    { ok: true, redirectTo: '/?recovered=1' },
    {
      headers: {
        'Set-Cookie': authCookie(req, SESSION_COOKIE, token, SESSION_SECONDS),
      },
    },
  );
}
