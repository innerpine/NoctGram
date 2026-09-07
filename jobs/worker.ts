interface JobsEnv {
  NOCTGRAM_ORIGIN: string;
  NOCT_JOBS_SECRET: string;
}
const jobsWorker = {
  async scheduled(
    _event: ScheduledController,
    env: JobsEnv,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      (async () => {
        const url = new URL('/api/jobs/run', env.NOCTGRAM_ORIGIN);
        if (url.protocol !== 'https:') throw new Error('HTTPS origin required');
        const r = await fetch(url, {
          method: 'POST',
          headers: { authorization: 'Bearer ' + env.NOCT_JOBS_SECRET },
          redirect: 'error',
          signal: AbortSignal.timeout(90000),
        });
        await r.body?.cancel();
        if (!r.ok) throw new Error('Notification job failed: ' + r.status);
      })(),
    );
  },
};

export default jobsWorker;
