import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/api-error.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { failure, ApiError } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

void test('D1 daily limits return a temporary outage and retry time at midnight UTC', async (t) => {
  t.mock.method(Date, 'now', () => Date.UTC(2026, 8, 9, 17));
  for (const kind of ['read', 'write']) {
    const response = failure(
      new Error(
        `D1_ERROR: Your account has exceeded D1's free tier daily row ${kind} limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.`,
      ),
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Retry-After'), '25200');
    const body = await response.json();
    assert.equal(body.code, 'DATABASE_DAILY_LIMIT');
    assert.match(body.error, /00:00 UTC/);
    assert.doesNotMatch(body.error, /сохранить изменения|SELECT|paid plan/);
  }
});

void test('ordinary API failures retain their status and are not diagnosed as quota exhaustion', async () => {
  const response = failure(new ApiError(403, 'Нет доступа', 'FORBIDDEN'));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: 'Нет доступа',
    code: 'FORBIDDEN',
  });
});
