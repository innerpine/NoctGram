import { readJsonBody } from '@/lib/request-body';
import { setting } from '@/lib/auth-session';
import { ApiError, failure } from '@/lib/api-error';
import {
  managedAccounts,
  switchAccount,
  requirePersonalAccount,
} from '@/lib/managed-accounts';
import { accountAction, accountStatus } from '@/lib/account-management';
import {
  authStatus,
  finishEmail,
  finishOnboarding,
  RateError,
  signOut,
  startEmail,
} from '@/lib/email-auth';
export const dynamic = 'force-dynamic';
function privateResponse(response: Response) {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
export async function GET(
  req: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    if ((await params).action === 'accounts')
      return privateResponse(Response.json(await managedAccounts()));
    if ((await params).action === 'account') {
      await requirePersonalAccount();
      return privateResponse(Response.json(await accountStatus(req)));
    }
    if ((await params).action !== 'session')
      throw new ApiError(404, 'Не найдено');
    return privateResponse(Response.json(await authStatus(req)));
  } catch (e) {
    return privateResponse(failure(e));
  }
}
async function body(req: Request) {
  const data = await readJsonBody(req, 4096);
  // Read only the bounded body before rejecting, so keep-alive connections are drained.
  // All authentication and provider work remains behind the origin/type checks.
  if (
    req.headers.get('origin') !== new URL(req.url).origin ||
    req.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new ApiError(403, 'Недопустимый источник запроса.');
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    throw new ApiError(415, 'Ожидается JSON.');
  return data;
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const data = await body(req),
      action = (await params).action;
    if (action === 'switch-account')
      return privateResponse(await switchAccount(data));
    if (
      !['start', 'verify', 'recover', 'logout'].includes(action) ||
      data.link === true
    )
      await requirePersonalAccount();
    if (
      setting('NOCT_AUTH_MODE') === 'access' &&
      !['onboarding', 'logout'].includes(action)
    )
      throw new ApiError(
        403,
        'В тестовой версии вход настроен через Cloudflare Access.',
      );
    let response: Response;
    if (action === 'start') response = await startEmail(req, data);
    else if (action === 'verify') response = await finishEmail(req, data);
    else if (action === 'onboarding') response = await finishOnboarding(data);
    else if (action === 'logout') response = await signOut(req);
    else response = await accountAction(req, action, data);
    return privateResponse(response);
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) {
      const retryAfter = e instanceof RateError ? e.retryAfter : 60;
      return privateResponse(
        Response.json(
          { error: e.message, code: e.code, retryAfter },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } },
        ),
      );
    }
    return privateResponse(failure(e));
  }
}
