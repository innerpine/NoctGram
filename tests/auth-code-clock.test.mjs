import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = stripTypeScriptTypes(
  readFileSync('lib/auth-code-clock.ts', 'utf8'),
);
const { authCodeClock } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);
await test('fresh OTP expiry ignores a wrong device date and later wall-clock jumps', () => {
  let monotonic = 100;
  const server = 1789280000000,
    expires = server + 300000;
  const clock = authCodeClock(server, () => monotonic);
  assert.equal(clock(), server);
  monotonic += 60000;
  assert.equal(expires - clock(), 240000);
  monotonic += 240000;
  assert.equal(clock(), expires);
  const resent = authCodeClock(server + 300000, () => monotonic);
  monotonic += 1000;
  assert.equal(resent(), server + 301000);
});
