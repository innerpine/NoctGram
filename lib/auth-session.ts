import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { db } from './storage';

export const SESSION_COOKIE = 'noct_session';
export const CHALLENGE_COOKIE = 'noct_email_challenge';
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const CODE_SECONDS = 300;
export function setting(name: string) {
  return (env as unknown as Record<string, string | undefined>)[name] || '';
}
// Keep migration access through Sites until the owner explicitly selects email-only.
export function sitesAuthEnabled() {
  return setting('NOCT_AUTH_MODE') !== 'email';
}
export function cookieValue(cookie: string | null, name: string) {
  return (
    cookie
      ?.split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(name + '='))
      ?.slice(name.length + 1) || ''
  );
}
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function tokenHash(value: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export function authCookie(
  req: Request,
  name: string,
  value: string,
  seconds: number,
) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export type Identity = {
  userId: string;
  fullName: string | null;
  source: 'email' | 'sites';
};
export async function identity(): Promise<Identity | null> {
  const h = await headers();
  const cookie = h.get('cookie');
  const token = cookieValue(cookie, SESSION_COOKIE);
  // An expired/invalid email session must never silently become a different Sites account.
  if (
    cookie?.split(';').some((p) => p.trim().startsWith(SESSION_COOKIE + '='))
  ) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const row = await db()
      .prepare(
        'SELECT userId FROM auth_sessions WHERE tokenHash=? AND expiresAt>?',
      )
      .bind(await tokenHash(token), Date.now())
      .first<{ userId: string }>();
    return row ? { userId: row.userId, fullName: null, source: 'email' } : null;
  }
  if (!sitesAuthEnabled()) return null;
  const user = await getChatGPTUser();
  return user
    ? { userId: user.userId, fullName: user.fullName, source: 'sites' }
    : null;
}
