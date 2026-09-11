import { headers } from 'next/headers';
import { db } from './storage';
import { ApiError } from './api-error';
import {
  identity,
  setting,
  cookieValue,
  tokenHash,
  SESSION_COOKIE,
} from './auth-session';
import { canManageAccount, managedTargets } from './managed-account-access';

async function personalSession() {
  const principal = await identity(false);
  if (!principal || principal.source !== 'email')
    throw new ApiError(401, 'Войдите через почту, чтобы переключать аккаунты.');
  const hash = await tokenHash(
    cookieValue((await headers()).get('cookie'), SESSION_COOKIE),
  );
  return { principal, hash };
}

export async function managedAccounts() {
  const { principal, hash } = await personalSession();
  const config = setting('NOCT_MANAGED_ACCOUNTS');
  const session = await db()
    .prepare(
      'SELECT actingAs FROM auth_sessions WHERE tokenHash=? AND userId=? AND expiresAt>?',
    )
    .bind(hash, principal.userId, Date.now())
    .first<{ actingAs: string }>();
  if (!session) throw new ApiError(401, 'Сессия завершена. Войдите снова.');
  const ids = [principal.userId];
  for (const target of managedTargets(config, principal.userId)) {
    if (await canManageAccount(config, principal.userId, target))
      ids.push(target);
  }
  const accounts = await db()
    .prepare(`SELECT u.id,u.name,u.avatar,h.handle FROM users u
    JOIN handles h ON h.userId=u.id AND h.main=1 WHERE u.id IN (${ids.map(() => '?').join(',')}) AND u.deletedAt=0`)
    .bind(...ids)
    .all();
  return {
    principalId: principal.userId,
    activeId: session.actingAs || principal.userId,
    accounts: accounts.results,
  };
}

export async function switchAccount(body: Record<string, unknown>) {
  const { principal, hash } = await personalSession();
  const target = body.accountId;
  if (typeof target !== 'string' || target.length > 100)
    throw new ApiError(400, 'Выберите аккаунт.');
  if (
    target !== principal.userId &&
    !(await canManageAccount(
      setting('NOCT_MANAGED_ACCOUNTS'),
      principal.userId,
      target,
    ))
  )
    throw new ApiError(403, 'У вас нет доступа к этому аккаунту.');
  const updated = await db()
    .prepare(`UPDATE auth_sessions SET actingAs=? WHERE tokenHash=? AND userId=? AND expiresAt>?
    AND EXISTS(SELECT 1 FROM users WHERE id=auth_sessions.userId AND deletedAt=0) RETURNING userId`)
    .bind(
      target === principal.userId ? '' : target,
      hash,
      principal.userId,
      Date.now(),
    )
    .first();
  if (!updated) throw new ApiError(401, 'Сессия завершена. Войдите снова.');
  const profile = await db()
    .prepare('SELECT handle FROM handles WHERE userId=? AND main=1')
    .bind(target)
    .first<{ handle: string }>();
  return Response.json({
    redirectTo: '/?profile=' + encodeURIComponent(profile?.handle || target),
  });
}

export async function requirePersonalAccount() {
  const current = await identity(false);
  if (!current || current.source !== 'email') return;
  const { principal, hash } = await personalSession();
  const row = await db()
    .prepare(
      'SELECT actingAs FROM auth_sessions WHERE tokenHash=? AND userId=? AND expiresAt>?',
    )
    .bind(hash, principal.userId, Date.now())
    .first<{ actingAs: string }>();
  if (row?.actingAs)
    throw new ApiError(
      403,
      'Почтой и безопасностью можно управлять только из личного аккаунта. Сначала переключитесь на него.',
    );
}
