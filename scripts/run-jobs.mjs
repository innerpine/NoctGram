const base = process.env.NOCT_JOBS_URL || 'http://localhost:3000';
const giveawaysOnly = process.argv.includes('--giveaways');
if (!process.env.NOCT_JOBS_SECRET)
  throw Error('Run npm run setup:realtime first.');
let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});
console.log(
  `Noctgram ${giveawaysOnly ? 'giveaway' : 'notification'} worker running. Keep this process and the app server running.`,
);
while (!stopped) {
  try {
    const r = await fetch(
      new URL(
        giveawaysOnly ? '/api/jobs/run?task=giveaways' : '/api/jobs/run',
        base,
      ),
      {
        method: 'POST',
        headers: { authorization: 'Bearer ' + process.env.NOCT_JOBS_SECRET },
        signal: AbortSignal.timeout(85000),
        redirect: 'error',
      },
    );
    if (!r.ok) console.error('Notification job returned HTTP ' + r.status);
    else await r.json();
  } catch (e) {
    console.error('Notification worker: ' + e.name);
  }
  if (!stopped) await new Promise((resolve) => setTimeout(resolve, 10000));
}
