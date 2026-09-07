import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8787',
  run = Date.now();
const a = 'features_a_' + run,
  b = 'features_b_' + run,
  c = 'features_c_' + run,
  d = 'features_d_' + run;
const auth = (u) => ({
  'oai-authenticated-user-id': u,
  'oai-authenticated-user-email': u + '@example.com',
  'Content-Type': 'application/json',
});
async function api(u, q = '', body) {
  const r = await fetch(base + '/api/social' + q, {
    headers: auth(u),
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }
  return { status: r.status, data };
}
async function ok(u, q = '', body) {
  const r = await api(u, q, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const created = [];
async function post(u, body) {
  await ok(u, '', { action: 'post', ...body });
  const rows = await ok(
    u,
    '?action=feed&user=' + encodeURIComponent(body.as || u),
  );
  const p = rows.find((p) =>
    body.text ? p.text === body.text : p.code === body.code,
  );
  assert.ok(p);
  created.push({ owner: u, id: p.id });
  return p;
}
async function wallet(u) {
  return ok(u, '?action=wallet');
}
try {
  for (const u of [a, b, c, d]) {
    await ok(u, '?action=bootstrap');
    assert.equal((await wallet(u)).balance, 10000);
  }
  const grants = await Promise.all([wallet(b), wallet(b)]);
  assert.ok(
    grants.every(
      (w) =>
        w.balance === 10000 &&
        w.transactions.filter((t) => t.kind === 'grant').length === 1,
    ),
  );
  const channel = await ok(a, '', {
    action: 'createChannel',
    name: 'Тестовый канал',
    handle: 'channel_' + run,
    bio: 'Публикации владельца',
  });
  assert.equal(channel.kind, 'channel');
  assert.equal(channel.ownerId, a);
  assert.equal(
    (
      await api(b, '', {
        action: 'createChannel',
        name: 'Чужой',
        handle: channel.handle,
      })
    ).status,
    409,
  );
  assert.equal(
    (await api(b, '', { action: 'handle', handle: channel.handle })).status,
    409,
  );
  assert.ok(
    (await ok(b, '?action=channels&q=' + channel.handle)).some(
      (c) => c.id === channel.id,
    ),
  );
  assert.ok(
    !(await ok(b, '?action=people&q=' + channel.handle)).some(
      (c) => c.id === channel.id,
    ),
  );
  assert.equal(
    (
      await api(b, '', {
        action: 'message',
        id: channel.id,
        text: 'not a person',
      })
    ).status,
    400,
  );
  assert.equal(
    (await api(b, '', { action: 'post', as: channel.id, text: 'forbidden' }))
      .status,
    403,
  );
  assert.equal(
    (
      await api(b, '', {
        action: 'profile',
        id: channel.id,
        name: 'Stolen',
        bio: '',
        avatar: '',
        cover: '',
      })
    ).status,
    403,
  );
  const code =
    '  const value = "<script>literal</script>";\n\tconsole.log(value);';
  const cp = await post(a, {
    as: channel.id,
    text: 'channel_post_' + run,
    code,
    codeLang: 'javascript',
  });
  assert.equal(cp.ownerId, a);
  assert.equal(cp.userId, channel.id);
  assert.equal(cp.code, code);
  assert.equal(
    (await api(b, '', { action: 'pin', id: cp.id, value: true })).status,
    403,
  );
  await ok(a, '', { action: 'pin', id: cp.id, value: true });
  assert.equal(
    (await ok(a, '?action=profile&id=' + channel.id)).pinnedPostId,
    cp.id,
  );
  await ok(b, '', { action: 'follow', id: channel.id, value: true });
  assert.ok(
    (await ok(b, '?action=feed&mode=following')).some((p) => p.id === cp.id),
  );
  const codeOnly = await post(a, {
    text: '',
    code: '  let codeOnly = ' + run + ';',
    codeLang: 'typescript',
  });
  assert.equal(codeOnly.text, '');
  assert.equal(
    (await api(a, '', { action: 'post', text: '', code: ' ' })).status,
    400,
  );
  assert.equal(
    (await api(a, '', { action: 'post', text: 'bad', code: 'x'.repeat(20001) }))
      .status,
    400,
  );
  const form = new FormData();
  form.set(
    'file',
    new File(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
          'base64',
        ),
      ],
      'adult-fixture.png',
      { type: 'image/png' },
    ),
  );
  const upload = await fetch(base + '/api/upload', {
    method: 'POST',
    headers: {
      'oai-authenticated-user-id': a,
      'oai-authenticated-user-email': a + '@example.com',
    },
    body: form,
  });
  assert.equal(upload.status, 200);
  const media = await upload.json();
  const adult = await post(a, {
    text: 'visible_text_' + run,
    media: [media.id],
    adult: true,
  });
  assert.equal(adult.adult, 1);
  assert.equal(adult.text, 'visible_text_' + run);
  assert.equal(adult.media.length, 1);
  await ok(a, '', { action: 'view', id: cp.id });
  assert.equal(
    (await ok(a, '?action=post&id=' + cp.id)).views,
    0,
    'Channel owner is excluded',
  );
  await Promise.all(
    Array.from({ length: 5 }, () => ok(b, '', { action: 'view', id: cp.id })),
  );
  await ok(c, '', { action: 'view', id: cp.id });
  assert.equal(
    (await ok(a, '?action=post&id=' + cp.id)).views,
    2,
    'Views remain unique',
  );
  const ap = await ok(a, '?action=profile'),
    bp = await ok(b, '?action=profile');
  const primary = 'main_' + run,
    sub = 'sub_' + run;
  await ok(a, '', {
    action: 'profile',
    name: 'Author A',
    bio: ap.bio,
    avatar: '',
    cover: '',
    mainHandle: primary,
    extraHandles: [sub],
  });
  let edited = await ok(a, '?action=profile');
  assert.equal(edited.handle, primary);
  assert.deepEqual(edited.handles, [primary, sub]);
  assert.equal(
    (
      await api(a, '', {
        action: 'profile',
        name: 'Must not change',
        bio: '',
        avatar: '',
        cover: '',
        mainHandle: bp.handle,
        extraHandles: [],
      })
    ).status,
    409,
  );
  edited = await ok(a, '?action=profile');
  assert.equal(edited.name, 'Author A');
  assert.equal(edited.handle, primary);
  assert.equal(
    (
      await api(a, '', {
        action: 'profile',
        name: 'A',
        bio: '',
        avatar: '',
        cover: '',
        mainHandle: primary,
        extraHandles: [primary],
      })
    ).status,
    400,
  );
  assert.equal(
    (await api(a, '', { action: 'support', id: cp.id, amount: 1, key: 'self' }))
      .status,
    400,
  );
  for (const amount of [0, -1, 10001, 1.2, '100'])
    assert.equal(
      (
        await api(b, '', {
          action: 'support',
          id: cp.id,
          amount,
          key: 'invalid' + amount,
        })
      ).status,
      400,
    );
  await Promise.all([
    ok(b, '', { action: 'support', id: cp.id, amount: 1000, key: 'same' }),
    ok(b, '', { action: 'support', id: cp.id, amount: 1000, key: 'same' }),
  ]);
  assert.equal((await wallet(b)).balance, 9000);
  assert.equal((await wallet(a)).balance, 11000);
  assert.equal(
    (
      await api(b, '', {
        action: 'support',
        id: cp.id,
        amount: 2000,
        key: 'same',
      })
    ).status,
    409,
  );
  await ok(b, '', { action: 'support', id: cp.id, amount: 9000, key: 'rest' });
  assert.equal((await wallet(b)).balance, 0);
  const bpost = await post(b, { text: 'b_post_' + run });
  await ok(c, '', {
    action: 'support',
    id: bpost.id,
    amount: 2000,
    key: 'refill-b',
  });
  assert.equal((await wallet(b)).balance, 2000);
  assert.equal(
    (
      await api(b, '', {
        action: 'support',
        id: cp.id,
        amount: 1,
        key: 'over-post-limit',
      })
    ).status,
    409,
    'Per-post cap cannot be bypassed by refilling balance',
  );
  const competing = await Promise.all([
    api(d, '', {
      action: 'support',
      id: adult.id,
      amount: 8000,
      key: 'concurrent-1',
    }),
    api(d, '', {
      action: 'support',
      id: bpost.id,
      amount: 8000,
      key: 'concurrent-2',
    }),
  ]);
  assert.deepEqual(
    competing.map((r) => r.status).sort((a, b) => a - b),
    [200, 409],
  );
  assert.equal(
    (await wallet(d)).balance,
    2000,
    'Concurrent payments cannot overdraw the ledger',
  );
  const funded = await ok(b, '?action=post&id=' + cp.id);
  assert.equal(funded.stars, 10000);
  assert.equal(funded.mySupport, 10000);
  const beforeDelete = (await wallet(a)).balance;
  await ok(a, '', { action: 'delete', id: cp.id });
  assert.equal((await wallet(a)).balance, beforeDelete);
  assert.ok(
    (await wallet(b)).transactions.some(
      (t) => t.kind === 'support' && t.postId === null,
    ),
    'Post removal retains transaction history',
  );
  assert.equal(
    (await api(c, '', { action: 'delete', id: adult.id })).status,
    403,
  );
  console.log(
    'PASS: channel creation/ownership/subscriptions, shared handles and atomic profile edits, code-only posts and whitespace, 18+ media flags, unique views, test grants, idempotent tips, per-post cap, concurrent overdraft prevention and retained ledger history.',
  );
} finally {
  for (const p of created)
    await api(p.owner, '', { action: 'delete', id: p.id });
}
