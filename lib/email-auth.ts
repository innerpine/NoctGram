import { assertStaticAvatar } from './avatar-media';
import { identity as currentIdentity } from './auth-session';
import { removePushDevice } from './notifications';
import { db } from './storage';
import { ApiError } from './api-error';
import { clean, viewer } from './server';
import { assertWritable } from './account-access';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  authCookie,
  CHALLENGE_COOKIE,
  CODE_SECONDS,
  cookieValue,
  identity,
  randomToken,
  SESSION_COOKIE,
  SESSION_SECONDS,
  sitesAuthEnabled,
  setting,
  tokenHash,
} from './auth-session';
import {
  emailConfig,
  requireEmailConfig,
  sendEmailCode,
  verifyEmailCode,
} from './email-provider';

type Challenge = {
  tokenHash: string;
  email: string;
  linkUserId: string | null;
  attempts: number;
  created: number;
  expiresAt: number;
};
function signupPremiumDays() {
  return setting('NOCT_SIGNUP_PREMIUM') === '1' ? 3 : 0;
}
export class RateError extends ApiError {
  constructor(public retryAfter: number) {
    super(
      429,
      'Слишком много попыток. Подождите перед следующим запросом.',
      'RATE_LIMIT',
    );
  }
}
export async function limit(
  scope: string,
  value: string,
  max: number,
  seconds: number,
) {
  const key = scope + ':' + (await tokenHash(value)),
    now = Date.now();
  const accepted = await db()
    .prepare(`INSERT INTO auth_limits(key,count,expiresAt) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN expiresAt<=? THEN 1 ELSE count+1 END,
      expiresAt=CASE WHEN expiresAt<=? THEN excluded.expiresAt ELSE expiresAt END
    WHERE expiresAt<=? OR count<? RETURNING key`)
    .bind(key, now + seconds * 1000, now, now, now, max)
    .first();
  if (!accepted) {
    const row = await db()
      .prepare('SELECT expiresAt FROM auth_limits WHERE key=?')
      .bind(key)
      .first<{ expiresAt: number }>();
    throw new RateError(
      Math.max(
        1,
        Math.ceil(((row?.expiresAt || now + seconds * 1000) - now) / 1000),
      ),
    );
  }
}
export function clientIp(req: Request) {
  // Cloudflare supplies this header. Do not trust arbitrary forwarded-for chains.
  return req.headers.get('cf-connecting-ip') || 'unknown';
}
export function emailAddress(value: unknown) {
  const email = clean(value, 254, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new ApiError(400, 'Введите адрес электронной почты.');
  return email;
}
async function challenge(req: Request) {
  const token = cookieValue(req.headers.get('cookie'), CHALLENGE_COOKIE);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return db()
    .prepare(
      'SELECT * FROM auth_challenges WHERE tokenHash=? AND expiresAt>? AND attempts<5',
    )
    .bind(await tokenHash(token), Date.now())
    .first<Challenge>();
}
async function cleanup() {
  const now = Date.now();
  await db().batch([
    db()
      .prepare(
        'DELETE FROM auth_challenges WHERE tokenHash IN (SELECT tokenHash FROM auth_challenges WHERE expiresAt<=? LIMIT 100)',
      )
      .bind(now),
    db()
      .prepare(
        'DELETE FROM auth_sessions WHERE tokenHash IN (SELECT tokenHash FROM auth_sessions WHERE expiresAt<=? LIMIT 100)',
      )
      .bind(now),
    db()
      .prepare(
        'DELETE FROM auth_limits WHERE key IN (SELECT key FROM auth_limits WHERE expiresAt<=? LIMIT 100)',
      )
      .bind(now),
  ]);
}
export async function authStatus(req: Request) {
  const current = await identity();
  const me = current ? await viewer(true) : null;
  const person = me
    ? await db()
        .prepare(
          "SELECT u.id,u.name,u.avatar,u.onboardingComplete,h.handle,pe.expiresAt AS welcomePremiumExpiresAt FROM users u JOIN handles h ON h.userId=u.id AND h.main=1 LEFT JOIN premium_entitlements pe ON pe.userId=u.id AND pe.source='welcome' AND pe.revokedAt=0 AND pe.startsAt<=? AND pe.expiresAt>? WHERE u.id=?",
        )
        .bind(Date.now(), Date.now(), me)
        .first<{
          id: string;
          name: string;
          avatar: string;
          onboardingComplete: number;
          handle: string;
          welcomePremiumExpiresAt: number | null;
        }>()
    : null;
  const linked = me
    ? await db()
        .prepare('SELECT email FROM auth_identities WHERE userId=?')
        .bind(me)
        .first<{ email: string }>()
    : null;
  const pending = await challenge(req);
  return {
    serverTime: Date.now(),
    emailEnabled: !!emailConfig(),
    sitesEnabled: sitesAuthEnabled(),
    signupPremiumDays: emailConfig() ? signupPremiumDays() : 0,
    user: person
      ? {
          id: person.id,
          name: person.name,
          handle: person.handle,
          avatar: person.avatar,
          onboardingComplete: !!person.onboardingComplete,
          email: linked?.email || null,
          welcomePremiumExpiresAt: person.welcomePremiumExpiresAt || null,
        }
      : null,
    challenge:
      pending && (!pending.linkUserId || pending.linkUserId === me)
        ? {
            email: pending.email,
            expiresAt: pending.expiresAt,
            resendAt: pending.created + 60000,
            link: !!pending.linkUserId,
          }
        : null,
  };
}
export async function startEmail(req: Request, b: Record<string, unknown>) {
  requireEmailConfig();
  const email = emailAddress(b.email),
    link = b.link === true;
  const current = await identity();
  let linkUserId: string | null = null;
  if (link) {
    linkUserId = await viewer();
    await assertWritable(linkUserId);
    if (
      await db()
        .prepare('SELECT userId FROM auth_identities WHERE userId=?')
        .bind(linkUserId)
        .first()
    )
      throw new ApiError(409, 'К этому аккаунту уже привязана почта.');
  } else if (current)
    throw new ApiError(409, 'Вы уже вошли. Привяжите почту из своего профиля.');
  await limit('send-ip', clientIp(req), 20, 3600);
  await limit('send-email', email, 5, 3600);
  await limit('resend', email, 1, 60);
  const now = Date.now();
  await sendEmailCode(email);
  const token = randomToken();
  const old = cookieValue(req.headers.get('cookie'), CHALLENGE_COOKIE);
  await db().batch([
    db()
      .prepare('DELETE FROM auth_challenges WHERE tokenHash=?')
      .bind(await tokenHash(old)),
    db()
      .prepare(
        'INSERT INTO auth_challenges(tokenHash,email,linkUserId,created,expiresAt) VALUES(?,?,?,?,?)',
      )
      .bind(
        await tokenHash(token),
        email,
        linkUserId,
        now,
        now + CODE_SECONDS * 1000,
      ),
  ]);
  await cleanup();
  return Response.json(
    {
      serverTime: Date.now(),
      email,
      expiresAt: now + CODE_SECONDS * 1000,
      resendAt: now + 60000,
    },
    {
      headers: {
        'Set-Cookie': authCookie(req, CHALLENGE_COOKIE, token, CODE_SECONDS),
      },
    },
  );
}
async function bindEmail(
  subject: string,
  email: string,
  existingUser: string | null,
) {
  const d = db();
  const known = await d
    .prepare('SELECT userId FROM auth_identities WHERE subject=?')
    .bind(subject)
    .first<{ userId: string }>();
  if (known) {
    if (existingUser && known.userId !== existingUser)
      throw new ApiError(409, 'Эта почта уже привязана к другому аккаунту.');
    await d
      .prepare('UPDATE auth_identities SET email=? WHERE subject=?')
      .bind(email, subject)
      .run();
    return known.userId;
  }
  if (existingUser) {
    try {
      await d
        .prepare(
          'INSERT INTO auth_identities(subject,userId,email,created) VALUES(?,?,?,?)',
        )
        .bind(subject, existingUser, email, Date.now())
        .run();
    } catch (e) {
      if (String(e).includes('UNIQUE'))
        throw new ApiError(
          409,
          'Почта или аккаунт уже привязаны. Обновите страницу.',
        );
      throw e;
    }
    return existingUser;
  }
  const id = 'email_' + crypto.randomUUID(),
    handle = 'user_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16),
    now = Date.now(),
    startsAt = Math.floor(now / 1000) * 1000,
    bonusDays = signupPremiumDays();
  // Conditional inserts in one transaction prevent duplicate accounts on concurrent verification.
  await d.batch([
    d
      .prepare(
        "INSERT INTO users(id,name,created,onboardingComplete) SELECT ?,'Новый пользователь',?,0 WHERE NOT EXISTS(SELECT 1 FROM auth_identities WHERE subject=?)",
      )
      .bind(id, now, subject),
    d
      .prepare(
        'INSERT INTO handles(handle,userId,main) SELECT ?,?,1 WHERE EXISTS(SELECT 1 FROM users WHERE id=?)',
      )
      .bind(handle, id, id),
    d
      .prepare(
        'INSERT INTO auth_identities(subject,userId,email,created) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=?)',
      )
      .bind(subject, id, email, now, id),
    // This runs in the account-creation transaction, for its newly generated ID
    // only. Existing accounts, linking and concurrent verification cannot renew it.
    ...(bonusDays
      ? [
          d
            .prepare(
              "INSERT INTO premium_entitlements(userId,startsAt,expiresAt,source,created) SELECT id,?,?,'welcome',? FROM users WHERE id=? AND created=? AND kind='person' AND deletedAt=0 ON CONFLICT(userId) DO NOTHING",
            )
            .bind(startsAt, startsAt + bonusDays * 86400000, now, id, now),
        ]
      : []),
  ]);
  const result = await d
    .prepare('SELECT userId FROM auth_identities WHERE subject=?')
    .bind(subject)
    .first<{ userId: string }>();
  if (!result)
    throw new ApiError(503, 'Не удалось создать аккаунт. Попробуйте ещё раз.');
  return result.userId;
}
export async function finishEmail(req: Request, b: Record<string, unknown>) {
  requireEmailConfig();
  const code = clean(b.code, 6, true);
  if (!/^\d{6}$/.test(code))
    throw new ApiError(400, 'Введите шесть цифр из письма.');
  await limit('verify-ip', clientIp(req), 60, 600);
  const pendingToken = cookieValue(req.headers.get('cookie'), CHALLENGE_COOKIE);
  if (!/^[a-f0-9]{64}$/.test(pendingToken))
    throw new ApiError(
      400,
      'Откройте страницу в том же браузере, где запрашивали код, или запросите письмо здесь.',
      'CHALLENGE_MISSING',
    );
  const pending = await db()
    .prepare('SELECT * FROM auth_challenges WHERE tokenHash=?')
    .bind(await tokenHash(pendingToken))
    .first<Challenge>();
  if (!pending || pending.expiresAt <= Date.now())
    throw new ApiError(
      400,
      'Время входа истекло. Запросите новое письмо.',
      'CODE_EXPIRED',
    );
  if (pending.attempts >= 5)
    throw new ApiError(
      400,
      'Попытки закончились. Запросите новый код.',
      'CODE_ATTEMPTS',
    );
  if (b.email !== undefined && emailAddress(b.email) !== pending.email)
    throw new ApiError(
      409,
      'В другой вкладке запрошен код для другой почты. Начните вход заново.',
      'CHALLENGE_CHANGED',
    );
  const current = await identity();
  if (pending.linkUserId ? current?.userId !== pending.linkUserId : !!current)
    throw new ApiError(
      409,
      'Аккаунт в этой вкладке изменился. Начните вход заново.',
    );
  if (pending.linkUserId) await assertWritable(pending.linkUserId);
  await limit('verify-email', pending.email, 10, 600);
  const attempt = await db()
    .prepare(
      'UPDATE auth_challenges SET attempts=attempts+1 WHERE tokenHash=? AND attempts<5 AND expiresAt>? RETURNING tokenHash',
    )
    .bind(pending.tokenHash, Date.now())
    .first();
  if (!attempt)
    throw new ApiError(
      400,
      'Попытки закончились. Запросите новый код.',
      'CODE_EXPIRED',
    );
  const proof = await verifyEmailCode(pending.email, code);
  if (pending.linkUserId) await assertWritable(pending.linkUserId);
  const consumed = await db()
    .prepare(
      'DELETE FROM auth_challenges WHERE tokenHash=? AND expiresAt>? RETURNING tokenHash',
    )
    .bind(pending.tokenHash, Date.now())
    .first();
  if (!consumed)
    throw new ApiError(
      400,
      'Этот код уже использован или истёк. Запросите новый.',
      'CODE_EXPIRED',
    );
  const me = await bindEmail(proof.subject, proof.email, pending.linkUserId);
  const token = randomToken(),
    now = Date.now();
  const old = cookieValue(req.headers.get('cookie'), SESSION_COOKIE);
  const sessions = await db().batch([
    db()
      .prepare('DELETE FROM auth_sessions WHERE tokenHash=?')
      .bind(await tokenHash(old)),
    db()
      .prepare(
        'INSERT INTO auth_sessions(tokenHash,userId,created,expiresAt,verifiedAt) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users u JOIN auth_identities a ON a.userId=u.id WHERE u.id=? AND u.deletedAt=0 AND u.sessionsRevokedAt<? AND a.subject=? AND a.email=?)',
      )
      .bind(
        await tokenHash(token),
        me,
        now,
        now + SESSION_SECONDS * 1000,
        now,
        me,
        pending.created,
        proof.subject,
        proof.email,
      ),
  ]);
  if (!sessions[1].meta.changes)
    throw new ApiError(409, 'Вход отозван. Запросите новый код.');
  const person = await db()
    .prepare('SELECT onboardingComplete FROM users WHERE id=?')
    .bind(me)
    .first<{ onboardingComplete: number }>();
  const response = Response.json({
    linked: !!pending.linkUserId,
    redirectTo: person?.onboardingComplete ? '/' : '/welcome',
  });
  response.headers.append(
    'Set-Cookie',
    authCookie(req, SESSION_COOKIE, token, SESSION_SECONDS),
  );
  response.headers.append(
    'Set-Cookie',
    authCookie(req, CHALLENGE_COOKIE, '', 0),
  );
  return response;
}
export async function finishOnboarding(b: Record<string, unknown>) {
  const me = await viewer(true);
  await assertWritable(me);
  const user = await db()
    .prepare('SELECT onboardingComplete FROM users WHERE id=?')
    .bind(me)
    .first<{ onboardingComplete: number }>();
  if (user?.onboardingComplete) return Response.json({ redirectTo: '/' });
  const name = clean(b.name, 40, true),
    handle = clean(b.handle, 25, true).replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{4,24}$/.test(handle))
    throw new ApiError(400, 'Юзернейм: 4–24 латинские буквы, цифры или _.');
  if (
    ['admin', 'support', 'system', 'noctgram', 'premium', 'root'].includes(
      handle,
    )
  )
    throw new ApiError(409, 'Этот юзернейм недоступен.');
  const avatar = clean(b.avatar || '', 200);
  if (
    avatar &&
    (!/^\/api\/media\/[a-f0-9-]{36}$/.test(avatar) ||
      !(await db()
        .prepare(
          "SELECT id FROM uploads WHERE id=? AND userId=? AND type LIKE 'image/%'",
        )
        .bind(avatar.slice('/api/media/'.length), me)
        .first()))
  )
    throw new ApiError(400, 'Загрузите свою аватарку ещё раз.');
  if (avatar) await assertStaticAvatar(avatar);
  try {
    await db().batch([
      db()
        .prepare(
          'DELETE FROM handles WHERE userId=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND onboardingComplete=0)',
        )
        .bind(me, me),
      db()
        .prepare(
          'INSERT INTO handles(handle,userId,main) SELECT ?,?,1 WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND onboardingComplete=0)',
        )
        .bind(handle, me, me),
      db()
        .prepare(
          'UPDATE users SET name=?,avatar=?,onboardingComplete=1 WHERE id=? AND onboardingComplete=0',
        )
        .bind(name, avatar, me),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE'))
      throw new ApiError(409, 'Этот юзернейм уже занят. Выберите другой.');
    throw e;
  }
  return Response.json({ redirectTo: '/' });
}
export async function signOut(req: Request) {
  const current = await currentIdentity(false);
  await removePushDevice();
  if (current) {
    await db().batch([
      db()
        .prepare(
          "UPDATE calls SET status='ended',reason='completed',endedAt=?,offer=NULL,answer=NULL WHERE (caller=? OR callee=?) AND status<>'ended'",
        )
        .bind(Date.now(), current.userId, current.userId),
      db()
        .prepare(
          "DELETE FROM call_signals WHERE callId IN(SELECT id FROM calls WHERE status='ended' AND (caller=? OR callee=?))",
        )
        .bind(current.userId, current.userId),
    ]);
  }
  const token = cookieValue(req.headers.get('cookie'), SESSION_COOKIE),
    pending = cookieValue(req.headers.get('cookie'), CHALLENGE_COOKIE);
  await db().batch([
    db()
      .prepare('DELETE FROM auth_sessions WHERE tokenHash=?')
      .bind(await tokenHash(token)),
    db()
      .prepare('DELETE FROM auth_challenges WHERE tokenHash=?')
      .bind(await tokenHash(pending)),
  ]);
  const platform = sitesAuthEnabled() && (await getChatGPTUser());
  const response = Response.json({
    redirectTo:
      setting('NOCT_AUTH_MODE') === 'access'
        ? '/cdn-cgi/access/logout'
        : platform
          ? '/signout-with-chatgpt?return_to=%2Flogin'
          : '/login',
  });
  response.headers.append('Set-Cookie', authCookie(req, SESSION_COOKIE, '', 0));
  response.headers.append(
    'Set-Cookie',
    authCookie(req, CHALLENGE_COOKIE, '', 0),
  );
  return response;
}
