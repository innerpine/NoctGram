import app from 'vinext/server/fetch-handler';
import { accessIdentity, type AccessSettings } from '../lib/access-auth';

// This entry point is used only by the separate Cloudflare preview build.
// Even a direct workers.dev request must prove its identity before app code runs.
const previewWorker = {
  async fetch(
    request: Request,
    env: AccessSettings & { ASSETS: Fetcher },
    ctx: ExecutionContext,
  ) {
    const member = await accessIdentity(request.headers, env);
    if (!member)
      return new Response(
        'Закрытая тестовая версия. Войдите через Cloudflare Access.',
        {
          status: 403,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        },
      );
    // run_worker_first protects assets too; serve uploaded files explicitly
    // after authentication instead of sending JavaScript/CSS through React.
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
        name.startsWith('x-noct-preview-')
      )
        headers.delete(name);
    }
    return app.fetch(new Request(request, { headers }), env, ctx);
  },
  async scheduled(
    _event: ScheduledController,
    env: AccessSettings & { NOCT_JOBS_SECRET?: string },
    ctx: ExecutionContext,
  ) {
    if (!env.NOCT_JOBS_SECRET)
      throw new Error('The preview job secret is not configured');
    const response = await app.fetch(
      new Request('https://preview.internal/api/jobs/run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.NOCT_JOBS_SECRET}` },
      }),
      env,
      ctx,
    );
    if (!response.ok)
      throw new Error(`Preview jobs returned ${response.status}`);
  },
};
export default previewWorker;
