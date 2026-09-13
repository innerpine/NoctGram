import app from 'vinext/server/fetch-handler';

type PublicSettings = {
  ASSETS: Fetcher;
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
    return app.fetch(new Request(request, { headers }), env, ctx);
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
