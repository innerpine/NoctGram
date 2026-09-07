import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw Error('Only isolated local Worker');
async function home(
  period = '7',
  charts = '1',
  user = 'zz_chart_qa_me',
  leaders = '0',
) {
  const response = await fetch(
    base +
      '/api/music?' +
      new URLSearchParams({ action: 'home', period, charts, leaders }),
    {
      headers: {
        'oai-authenticated-user-id': user,
        'oai-authenticated-user-email': 'chart-fixture@example.test',
      },
    },
  );
  return { status: response.status, data: await response.json() };
}
const today = (await home('today')).data;
assert.equal(today.listeners.length, 25);
assert.ok(today.mine.rank > 25);
assert.equal(today.mine.plays, 1);
assert.ok(today.mine.participants >= 36);
assert.equal(
  today.listeners.some((p) => p.id === 'zz_chart_qa_me'),
  false,
);
assert.equal(
  today.tracks.some((t) => t.id === 'chart_qa_2d'),
  false,
);
assert.equal(
  today.tracks.some((t) => t.id === 'chart_qa_10d'),
  false,
);
const week = (await home('7', '1', 'chart_qa_period')).data;
assert.equal(week.mine.plays, 1);
assert.equal(
  week.tracks.some((t) => t.id === 'chart_qa_2d'),
  true,
);
assert.equal(
  week.tracks.some((t) => t.id === 'chart_qa_10d'),
  false,
);
const month = (await home('30', '1', 'chart_qa_period')).data;
assert.equal(month.mine.plays, 2);
assert.equal(
  month.tracks.some((t) => t.id === 'chart_qa_10d'),
  true,
);
assert.equal(
  month.tracks.some((t) => t.id === 'chart_qa_40d'),
  false,
);
const light = (await home('7', '0')).data;
assert.deepEqual(light.tracks, []);
assert.deepEqual(light.artists, []);
assert.deepEqual(light.listeners, []);
assert.equal(light.mine, null);
const compact = (await home('7', '0', 'zz_chart_qa_me', '1')).data;
assert.equal(compact.listeners.length, 25);
assert.ok(compact.mine.rank > 25);
assert.equal(compact.profile.id, 'zz_chart_qa_me');
assert.equal(compact.mine.plays, 1);
assert.deepEqual(compact.tracks, []);
assert.deepEqual(compact.artists, []);
assert.equal((await home('bad')).status, 400);
console.log(
  'Charts: today/week/month boundaries, own rank beyond top 25, lightweight home and invalid period passed.',
);
