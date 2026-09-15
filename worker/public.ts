import app from 'vinext/server/fetch-handler';
import {
  prepareAccessRequest,
  checkAccessRequest,
} from '../lib/access-security';
import { failure } from '../lib/api-error';

type PublicSettings = {
  ASSETS: Fetcher;
  DB: D1Database;
  NOCT_DEPLOYMENT_TARGET?: string;
  NOCT_AUTH_MODE?: string;
  NOCT_AUTH_ALLOW_LOCAL_PROVIDER?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  NOCT_JOBS_SECRET?: string;
};

function configured(env: PublicSettings) {
  if (
    env.NOCT_DEPLOYMENT_TARGET !== 'standalone' ||
    env.NOCT_AUTH_MODE !== 'email' ||
    env.NOCT_AUTH_ALLOW_LOCAL_PROVIDER === '1' ||
    !env.SUPABASE_PUBLISHABLE_KEY?.trim()
  )
    return false;
  try {
    const url = new URL(env.SUPABASE_URL || '');
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

// This entry point never trusts identity headers supplied by public clients.
// The app resolves identity exclusively from its verified email session cookie.
const publicWorker = {
  async fetch(request: Request, env: PublicSettings, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (
      url.hostname === 'www.noctgram.com' ||
      (url.hostname === 'noctgram.com' && url.protocol === 'http:')
    ) {
      url.hostname = 'noctgram.com';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }
    if (!configured(env))
      return new Response('Сайт временно недоступен. Попробуйте позже.', {
        status: 503,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    if (request.method === 'GET' || request.method === 'HEAD') {
      const asset = await env.ASSETS.fetch(request);
      if (url.pathname === '/drop' || url.pathname.startsWith('/drop/')) {
        const response = new Response(asset.body, asset);
        response.headers.set('Cache-Control', 'no-cache');
        response.headers.set('X-Robots-Tag', 'noindex, nofollow');
        response.headers.set('Referrer-Policy', 'no-referrer');
        response.headers.set('X-Content-Type-Options', 'nosniff');
        return response;
      }
      if (
        asset.status !== 404 ||
        new URL(request.url).pathname.startsWith('/_next/static/')
      )
        return asset;
    }
    const headers = new Headers(request.headers);
    for (const name of Array.from(headers.keys())) {
      if (
        name.startsWith('oai-authenticated-') ||
        name.startsWith('x-noct-preview-') ||
        name === 'cf-access-jwt-assertion'
      )
        headers.delete(name);
    }
    const forwarded = new Request(request, { headers });
    let path = url.pathname;
    try {
      path = new URL(
        'https://noctgram.invalid' +
          decodeURIComponent(path).replace(/\/{2,}/g, '/'),
      ).pathname;
    } catch {
      /* Encoded paths still pass through the access gate. */
    }
    if (
      (!path.toLowerCase().startsWith('/api/') &&
        !url.pathname.includes('%')) ||
      path === '/api/auth/logout'
    )
      return app.fetch(forwarded, env, ctx);
    const access = prepareAccessRequest(forwarded);
    let response: Response;
    try {
      await checkAccessRequest(env.DB, access.request);
      response = await app.fetch(access.request, env, ctx);
      // Email verification can be in flight while an administrator blocks access.
      // Check the newly authenticated principal before delivering its session cookie.
      if (path === '/api/auth/verify' && response.ok) {
        const session = response.headers
          .getSetCookie()
          .find((cookie) => cookie.startsWith('noct_session='))
          ?.split(';')[0];
        if (session) {
          const verified = new Headers(access.request.headers);
          const cookies = (verified.get('cookie') || '')
            .split(';')
            .filter((cookie) => !cookie.trim().startsWith('noct_session='));
          verified.set('cookie', [...cookies, session].join('; '));
          await checkAccessRequest(
            env.DB,
            new Request(request.url, { headers: verified }),
          );
        }
      }
    } catch (error) {
      response = failure(error);
    }
    response = new Response(response.body, response);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    if (access.setCookie)
      response.headers.append('Set-Cookie', access.setCookie);
    return response;
  },
  async scheduled(
    event: ScheduledController,
    env: PublicSettings,
    ctx: ExecutionContext,
  ) {
    if (!configured(env) || !env.NOCT_JOBS_SECRET)
      throw new Error(
        'Public jobs require email authentication and a job secret',
      );
    // Presence is sampled every minute; the existing maintenance keeps its 5-minute cadence.
    const scheduledTime = event.scheduledTime ?? Date.now();
    const onlineOnly = Math.floor(scheduledTime / 60000) % 5 !== 0;
    const response = await app.fetch(
      new Request(
        'https://noctgram.com/api/jobs/run' +
          (onlineOnly ? '?onlineOnly=1' : ''),
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.NOCT_JOBS_SECRET}` },
        },
      ),
      env,
      ctx,
    );
    if (!response.ok)
      throw new Error(`Public jobs returned ${response.status}`);
  },
};
export default publicWorker;
