import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// Dedicated QA Worker only. This suite never calls Telegram or a payment API.
// Required QA vars: NOCT_BOT_TEST_MODE=1, NOCT_BOT_USERNAME=NoctgramQaBot,
// NOCT_BOT_SECRET=qa_telegram_bridge_secret_32_chars_for_tests.
assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Use Node 24+');
const base = 'http://127.0.0.1:8787';
const botSecret = 'qa_telegram_bridge_secret_32_chars_for_tests';
const stamp = Date.now();
const run = stamp + '_' + randomUUID().slice(0, 8);
const users = Object.fromEntries(
  [
    'a',
    'b',
    'proof',
    'expired',
    'quota',
    'quotaOther',
    'blocked',
    'readonly',
    'expiredOrder',
  ].map((name) => [name, 'telegram_' + name + '_' + run]),
);
const tg = (suffix) => String(BigInt(stamp) * 100n + BigInt(suffix));
const ids = {
  a: tg(1),
  b: tg(2),
  proof: tg(3),
  expired: tg(4),
  quota: tg(5),
  next: tg(6),
  blocked: tg(7),
  readonly: tg(8),
  expiredOrder: tg(9),
};
const headers = (id) => ({
  'oai-authenticated-user-id': id,
  'oai-authenticated-user-email': id + '@example.com',
  Origin: base,
});

async function local(url, options = {}) {
  assert.equal(
    new URL(url).origin,
    base,
    'Only the dedicated QA origin is permitted',
  );
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, data: await response.json() };
}
async function site(id, query = '', body, origin = base) {
  return local(base + '/api/social' + query, {
    headers: {
      ...headers(id),
      Origin: origin,
      'Content-Type': 'application/json',
    },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
}
async function bot(body, authorization = 'Bearer ' + botSecret) {
  return local(base + '/api/bot', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}
function accepted(response, label = 'Request') {
  assert.equal(
    response.status,
    200,
    label + ': ' + JSON.stringify(response.data),
  );
  return response.data;
}
async function siteOK(id, query = '', body) {
  return accepted(await site(id, query, body));
}
async function botOK(body) {
  return accepted(await bot(body));
}
function status(response, expected, label) {
  assert.equal(
    response.status,
    expected,
    label + ': ' + JSON.stringify(response.data),
  );
}
function noSecrets(value) {
  if (!value || typeof value !== 'object') return;
  const forbidden = new Set([
    'token',
    'tokenHash',
    'code',
    'codeHash',
    'secret',
    'authorization',
    'provider_token',
    'invoice_url',
    'currency',
    'total_amount',
    'telegram_payment_charge_id',
  ]);
  for (const [key, nested] of Object.entries(value)) {
    assert.ok(
      !forbidden.has(key),
      'Private proof or payment field leaked: ' + key,
    );
    noSecrets(nested);
  }
}
async function state(user) {
  const result = await siteOK(user, '?action=telegram');
  noSecrets(result);
  assert.equal(result.testMode, true);
  assert.equal(
    result.url,
    undefined,
    'Status must not return a reusable link token',
  );
  return result;
}
async function begin(user) {
  const result = await siteOK(user, '', { action: 'telegramLink' });
  noSecrets(result);
  const url = new URL(result.url);
  assert.equal(url.origin, 'https://t.me');
  assert.equal(url.pathname, '/NoctgramQaBot');
  const payload = url.searchParams.get('start');
  assert.match(payload, /^link_[a-f0-9]{32}$/);
  assert.ok(payload.length <= 64);
  assert.match(result.pending.id, /^[a-f0-9-]{36}$/);
  return { id: result.pending.id, token: payload.slice(5) };
}
async function claim(link, telegramId, code) {
  const result = await botOK({
    action: 'claim',
    telegramId,
    token: link.token,
    code,
    name: 'QA Telegram',
    username: 'qa_' + telegramId,
  });
  assert.deepEqual(result, { pending: true });
  return result;
}
async function confirm(user, link, code) {
  const result = await siteOK(user, '', {
    action: 'telegramConfirm',
    id: link.id,
    code,
  });
  noSecrets(result);
  assert.equal(result.pending, null);
  return result;
}
async function bind(user, telegramId, code) {
  const link = await begin(user);
  await claim(link, telegramId, code);
  const result = await confirm(user, link, code);
  assert.equal(result.link.telegramId, telegramId);
  return link;
}
async function order(telegramId, amount, label) {
  return (
    await botOK({
      action: 'order',
      telegramId,
      amount,
      key: 'qa_' + run + '_' + label,
    })
  ).order;
}
const wallet = (user) => siteOK(user, '?action=wallet');
function credits(walletState) {
  return walletState.transactions.filter((row) => row.kind === 'telegram_test');
}
function executeFixture(sql) {
  const qa = path.resolve('work/features-qa');
  assert.ok(qa.startsWith(path.resolve('work') + path.sep));
  execFileSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'd1',
      'execute',
      'DB',
      '--config',
      'wrangler.local.json',
      '--local',
      '--persist-to',
      qa,
      '--command',
      sql,
    ],
    { stdio: 'pipe' },
  );
}
function expireFixture(user) {
  assert.equal(
    user,
    users.expired,
    "Fixture may only touch this run's expiry user",
  );
  assert.match(user, /^telegram_expired_[0-9]+_[a-f0-9]{8}$/);
  executeFixture(
    `UPDATE telegram_challenges SET expiresAt=1 WHERE userId='${user}';`,
  );
}
function restrictionFixture(user, mode, clear = false) {
  assert.ok(['blocked', 'read_only'].includes(mode));
  assert.equal(
    user,
    mode === 'blocked' ? users.blocked : users.readonly,
    'Restriction fixture may only touch its own run-specific user',
  );
  assert.match(user, /^telegram_(blocked|readonly)_[0-9]+_[a-f0-9]{8}$/);
  const event = 'telegram_restriction_' + mode + '_' + run;
  if (clear) {
    executeFixture(
      `DELETE FROM account_restrictions WHERE userId='${user}' AND eventId='${event}';`,
    );
    return;
  }
  const created = Date.now();
  // A fixture actor satisfies the FK without granting anyone moderation privileges.
  executeFixture(`INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,expiresAt,created) VALUES('${event}','${user}','${user}','${mode}','QA Telegram restriction',NULL,${created});
    INSERT INTO account_restrictions(userId,eventId,mode,reason,expiresAt,created) VALUES('${user}','${event}','${mode}','QA Telegram restriction',NULL,${created});`);
}
function expireOrderFixture(orderId) {
  assert.match(
    orderId,
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  );
  assert.match(
    users.expiredOrder,
    /^telegram_expiredOrder_[0-9]+_[a-f0-9]{8}$/,
  );
  executeFixture(
    `UPDATE telegram_topups SET expiresAt=1 WHERE id='${orderId}' AND userId='${users.expiredOrder}' AND telegramId='${ids.expiredOrder}' AND status='pending';`,
  );
}

// Guard before any user/database mutation: fail if the running Worker is not QA.
for (const authorization of ['', 'Bearer wrong-qa-secret'])
  status(
    await bot({ action: 'health' }, authorization),
    401,
    'Bot bridge requires its own secret',
  );
const health = await botOK({ action: 'health' });
assert.equal(health.enabled, true, 'Start QA with NOCT_BOT_TEST_MODE=1');
assert.equal(
  health.botUsername,
  'NoctgramQaBot',
  'Refusing to run against a non-QA bot',
);
assert.equal(health.testMode, true);
assert.equal(health.dailyLimit, 50000);
assert.deepEqual(
  health.packages,
  [100, 150, 250, 350, 500, 750, 1000, 1500, 2500, 5000, 10000],
);
noSecrets(health);
for (const user of Object.values(users)) {
  assert.equal((await siteOK(user, '?action=bootstrap')).me.id, user);
  assert.equal((await state(user)).link, null);
}
status(
  await site(
    users.b,
    '',
    { action: 'telegramLink' },
    'https://untrusted.example',
  ),
  403,
  'Cross-origin site mutation',
);
assert.equal((await state(users.b)).pending, null);
status(
  await site(users.a, '', { action: 'credit', amount: 10000 }),
  400,
  'The browser social API cannot mint Stars',
);

const initialA = await wallet(users.a);
const initialB = await wallet(users.b);
assert.equal(initialA.balance, 10000);
assert.equal(initialA.sent, 0);
const linkA = await begin(users.a);
assert.equal((await state(users.a)).pending.telegramId, null);
status(
  await site(users.a, '', { action: 'telegramLink' }),
  429,
  'Link issuance cooldown',
);
await claim(linkA, ids.a, '15263748');
await claim(linkA, ids.a, '15263748');
const pendingA = (await state(users.a)).pending;
assert.equal(pendingA.telegramId, ids.a);
assert.ok(
  !JSON.stringify(pendingA).includes('15263748'),
  'Website status must not reveal the private-chat code',
);
status(
  await bot({
    action: 'claim',
    telegramId: ids.b,
    token: linkA.token,
    code: '15263748',
  }),
  409,
  'Another Telegram cannot steal a claimed link',
);
status(
  await bot({
    action: 'claim',
    telegramId: ids.a,
    token: linkA.token,
    code: '84736251',
  }),
  409,
  'Claim replay cannot replace the existing proof',
);
status(
  await site(users.b, '', {
    action: 'telegramConfirm',
    id: linkA.id,
    code: '15263748',
  }),
  400,
  'Only the originating website account can confirm',
);
assert.equal((await state(users.b)).link, null);
await confirm(users.a, linkA, '15263748');
await confirm(users.a, linkA, '15263748');
assert.equal((await state(users.a)).link.telegramId, ids.a);
status(
  await bot({
    action: 'claim',
    telegramId: ids.a,
    token: linkA.token,
    code: '15263748',
  }),
  410,
  'Consumed link cannot be reused',
);
await bind(users.b, ids.b, '26374851');
const botState = await botOK({ action: 'status', telegramId: ids.a });
assert.equal(botState.linked, true);
assert.equal(botState.balance, initialA.balance);
assert.equal(botState.usedToday, 0);
assert.equal(botState.testMode, true);
noSecrets(botState);

for (const amount of [0, -100, 1, 123, 10001, 50000, '100', 100.5, null])
  status(
    await bot({
      action: 'order',
      telegramId: ids.a,
      amount,
      key: 'invalid_' + run,
    }),
    400,
    'Unsupported or incorrectly typed package',
  );
const first = await order(ids.a, 100, 'first');
assert.equal(first.amount, 100);
assert.equal(first.status, 'pending');
noSecrets(first);
assert.equal(
  (await order(ids.a, 100, 'first')).id,
  first.id,
  'Quote request is idempotent',
);
status(
  await bot({
    action: 'order',
    telegramId: ids.a,
    amount: 150,
    key: 'qa_' + run + '_first',
  }),
  409,
  'Same key cannot change amount',
);
status(
  await bot({
    action: 'order',
    telegramId: ids.b,
    amount: 100,
    key: 'qa_' + run + '_first',
  }),
  409,
  'Another linked Telegram cannot reuse a request key',
);
status(
  await bot({ action: 'credit', telegramId: ids.b, id: first.id }),
  409,
  'Another linked Telegram cannot redeem the order',
);
const duplicates = await Promise.all(
  Array.from({ length: 8 }, () =>
    bot({ action: 'credit', telegramId: ids.a, id: first.id, amount: 50000 }),
  ),
);
for (const response of duplicates) {
  const result = accepted(response, 'Concurrent idempotent credit');
  assert.equal(
    result.order.amount,
    100,
    'Forged callback amount never changes the stored package',
  );
  assert.equal(result.order.status, 'credited');
  noSecrets(result);
}
const aWallet = await wallet(users.a);
assert.equal(aWallet.balance, initialA.balance + 100);
assert.equal(aWallet.sent, 0, 'Test top-up does not debit the user');
assert.equal(
  credits(aWallet).length,
  1,
  'Exactly one ledger entry after duplicate concurrent callbacks',
);
assert.equal(credits(aWallet)[0].id, 'telegram-test:' + first.id);
assert.equal(credits(aWallet)[0].amount, 100);
assert.equal(credits(aWallet)[0].sender, null);
assert.equal((await wallet(users.b)).balance, initialB.balance);

// An old pending order must fail even after relinking the same two accounts.
const abandoned = await order(ids.a, 150, 'abandoned');
await siteOK(users.a, '', { action: 'telegramUnlink' });
assert.equal(
  (await botOK({ action: 'status', telegramId: ids.a })).linked,
  false,
);
status(
  await bot({ action: 'credit', telegramId: ids.a, id: abandoned.id }),
  409,
  'Unlink revokes pending order access',
);
await bind(users.a, ids.a, '37485162');
status(
  await bot({ action: 'credit', telegramId: ids.a, id: abandoned.id }),
  409,
  'Relink does not reactivate an old link-scoped order',
);
assert.equal(
  (await botOK({ action: 'status', telegramId: ids.a })).usedToday,
  100,
);
assert.equal((await wallet(users.a)).balance, initialA.balance + 100);

const proof = await begin(users.proof);
await claim(proof, ids.proof, '48516273');
for (let attempt = 1; attempt <= 5; attempt++) {
  status(
    await site(users.proof, '', {
      action: 'telegramConfirm',
      id: proof.id,
      code: '99990000',
    }),
    400,
    'Wrong confirmation proof',
  );
  assert.equal(
    !!(await state(users.proof)).pending,
    attempt < 5,
    'Fifth failed proof exhausts the challenge',
  );
}
status(
  await site(users.proof, '', {
    action: 'telegramConfirm',
    id: proof.id,
    code: '48516273',
  }),
  400,
  'Correct proof cannot bypass exhausted attempts',
);
status(
  await bot({
    action: 'claim',
    telegramId: ids.proof,
    token: proof.token,
    code: '48516273',
  }),
  410,
  'An exhausted challenge cannot be reclaimed',
);
assert.equal((await state(users.proof)).link, null);
const expired = await begin(users.expired);
await claim(expired, ids.expired, '51627384');
expireFixture(users.expired);
status(
  await bot({
    action: 'claim',
    telegramId: ids.expired,
    token: expired.token,
    code: '51627384',
  }),
  410,
  'Expired deep link',
);
status(
  await site(users.expired, '', {
    action: 'telegramConfirm',
    id: expired.id,
    code: '51627384',
  }),
  400,
  'Expired confirmation proof',
);
assert.equal((await state(users.expired)).pending, null);
assert.equal((await state(users.expired)).link, null);

// Moderation imposed after quoting must prevent credit, while revocation stays available.
for (const [mode, user, telegramId, code] of [
  ['blocked', users.blocked, ids.blocked, '95162738'],
  ['read_only', users.readonly, ids.readonly, '16273849'],
]) {
  await bind(user, telegramId, code);
  const initial = await wallet(user);
  const pending = await order(telegramId, 500, 'restricted_' + mode);
  restrictionFixture(user, mode);
  try {
    const denied = await bot({ action: 'credit', telegramId, id: pending.id });
    status(denied, 403, mode + ' blocks credit of a previously issued order');
    assert.equal(
      denied.data.code,
      mode === 'blocked' ? 'ACCOUNT_BLOCKED' : 'READ_ONLY',
    );
    if (mode === 'blocked') {
      status(
        await site(user, '?action=wallet'),
        403,
        'Blocked account cannot read its wallet',
      );
    } else {
      assert.equal(
        (await wallet(user)).balance,
        initial.balance,
        'Read-only credit rejection leaves the wallet unchanged',
      );
    }
    const unlinked = await siteOK(user, '', { action: 'telegramUnlink' });
    assert.equal(
      unlinked.link,
      null,
      mode + ' still permits revoking Telegram access',
    );
    assert.equal(unlinked.pending, null);
    assert.equal((await botOK({ action: 'status', telegramId })).linked, false);
    status(
      await site(user, '', { action: 'telegramLink' }),
      403,
      mode + ' prevents beginning a new link after unlinking',
    );
  } finally {
    restrictionFixture(user, mode, true);
  }
  const after = await wallet(user);
  assert.equal(
    after.balance,
    initial.balance,
    mode + ' never credited the restricted order',
  );
  assert.deepEqual(
    credits(after),
    credits(initial),
    mode + ' creates no test-credit ledger entry',
  );
  assert.equal(
    (await state(user)).pending,
    null,
    'Rejected link creation leaves no pending proof',
  );
}

await bind(users.expiredOrder, ids.expiredOrder, '27384951');
const beforeExpiredOrder = await wallet(users.expiredOrder);
const expiredQuote = await order(ids.expiredOrder, 750, 'expired_order');
expireOrderFixture(expiredQuote.id);
status(
  await bot({
    action: 'credit',
    telegramId: ids.expiredOrder,
    id: expiredQuote.id,
  }),
  409,
  'An expired order cannot mint Stars',
);
const afterExpiredOrder = await wallet(users.expiredOrder);
assert.equal(afterExpiredOrder.balance, beforeExpiredOrder.balance);
assert.deepEqual(
  credits(afterExpiredOrder),
  credits(beforeExpiredOrder),
  'Expired order creates no ledger entry',
);
assert.equal(
  (await botOK({ action: 'status', telegramId: ids.expiredOrder })).usedToday,
  0,
  'Expired order does not consume the daily quota',
);

await bind(users.quota, ids.quota, '62738495');
const quotaInitial = await wallet(users.quota);
const quotes = await Promise.all(
  Array.from({ length: 6 }, (_, i) => order(ids.quota, 10000, 'quota_' + i)),
);
const quotaResults = await Promise.all(
  quotes.map((quote) =>
    bot({ action: 'credit', telegramId: ids.quota, id: quote.id }),
  ),
);
assert.equal(
  quotaResults.filter((r) => r.status === 200).length,
  5,
  'Only five concurrent 10000-Star credits fit the quota',
);
assert.equal(quotaResults.filter((r) => r.status === 409).length, 1);
const quotaWallet = await wallet(users.quota);
assert.equal(quotaWallet.balance, quotaInitial.balance + 50000);
assert.equal(quotaWallet.sent, 0);
assert.equal(credits(quotaWallet).length, 5);
assert.equal(
  credits(quotaWallet).reduce((sum, row) => sum + row.amount, 0),
  50000,
);
assert.ok(
  credits(quotaWallet).every(
    (row) => row.sender === null && row.recipient === users.quota,
  ),
);
assert.equal(
  (await botOK({ action: 'status', telegramId: ids.quota })).usedToday,
  50000,
);
const overQuota = await order(ids.quota, 100, 'over_quota');
status(
  await bot({ action: 'credit', telegramId: ids.quota, id: overQuota.id }),
  409,
  'Quota also rejects a smaller following package',
);

// The rolling quota survives either side of the account association changing.
await siteOK(users.quota, '', { action: 'telegramUnlink' });
await bind(users.quota, ids.next, '73849516');
assert.equal(
  (await botOK({ action: 'status', telegramId: ids.next })).usedToday,
  50000,
  'Noctgram account preserves spent quota after Telegram changes',
);
const changedTelegram = await order(ids.next, 100, 'changed_telegram');
status(
  await bot({ action: 'credit', telegramId: ids.next, id: changedTelegram.id }),
  409,
  'New Telegram does not reset website quota',
);
await siteOK(users.quota, '', { action: 'telegramUnlink' });
await bind(users.quotaOther, ids.quota, '84951627');
assert.equal(
  (await botOK({ action: 'status', telegramId: ids.quota })).usedToday,
  50000,
  'Telegram account preserves spent quota after Noctgram changes',
);
const changedSite = await order(ids.quota, 100, 'changed_site');
status(
  await bot({ action: 'credit', telegramId: ids.quota, id: changedSite.id }),
  409,
  'New website account does not reset Telegram quota',
);
assert.equal((await wallet(users.quotaOther)).balance, 10000);
assert.equal((await wallet(users.quota)).balance, quotaInitial.balance + 50000);
for (const action of ['invoice', 'sendInvoice'])
  status(
    await bot({ action, telegramId: ids.a }),
    400,
    'Bridge has no payment/invoice operation',
  );

console.log(
  'PASS Telegram: private proof/link ownership, expiry/attempts, bridge auth/CSRF, package validation, idempotent ledger credit, restrictions/revocation, expired orders, concurrent 50000 quota, unlink/rebind, test-only balance without debits.',
);
