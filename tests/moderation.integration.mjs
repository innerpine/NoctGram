import assert from 'node:assert/strict';
// Run only on an isolated local Worker after tests/fixtures/moderation.sql.
const base = 'http://127.0.0.1:8787',
  run = Date.now(),
  mod = 'mod_qa_admin',
  a = 'mod_author_' + run,
  b = 'mod_reader_' + run,
  c = 'mod_other_' + run;
const auth = (u) => ({
  'oai-authenticated-user-id': u,
  'oai-authenticated-user-email': u + '@example.com',
});
async function api(u, q = '', body) {
  const r = await fetch(base + '/api/social' + q, {
    headers: { ...auth(u), 'Content-Type': 'application/json' },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
async function ok(u, q = '', body) {
  const r = await api(u, q, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const account = (u) => ok(u, '?action=account');
const moderate = (id, mode, reason = 'QA decision', minutes = null) =>
  ok(mod, '', { action: 'moderate', id, mode, reason, minutes });
async function post(u, text, as, media = []) {
  await ok(u, '', { action: 'post', text, as, media });
  return (await ok(u, '?action=feed&user=' + encodeURIComponent(as || u))).find(
    (p) => p.text === text,
  );
}
const created = [];
try {
  for (const u of [mod, a, b, c]) await ok(u, '?action=bootstrap');
  assert.equal((await account(mod)).canModerate, true);
  assert.equal((await account(a)).canModerate, false);
  assert.equal((await api(a, '?action=moderationUsers')).status, 403);
  assert.equal(
    (await api(a, '?action=moderationUsers&id=noctgram')).status,
    403,
  );
  assert.equal((await api(a, '?action=moderationAppeals')).status, 403);
  assert.equal((await api(a, '?action=moderationHistory&id=' + b)).status, 403);
  assert.equal(
    (
      await api(a, '', {
        action: 'moderate',
        id: b,
        mode: 'blocked',
        reason: 'forged',
        minutes: null,
      })
    ).status,
    403,
  );
  await ok(a, '', {
    action: 'profile',
    name: 'Author',
    bio: 'Hidden bio',
    avatar: '',
    cover: '',
    canModerate: true,
  });
  assert.equal((await account(a)).canModerate, false);
  for (const id of [mod, 'noctgram'])
    assert.equal(
      (
        await api(mod, '', {
          action: 'moderate',
          id,
          mode: 'blocked',
          reason: 'protected',
          minutes: null,
        })
      ).status,
      403,
    );
  for (const minutes of [0, -1, 1.5, '60', 525601])
    assert.equal(
      (
        await api(mod, '', {
          action: 'moderate',
          id: a,
          mode: 'blocked',
          reason: 'invalid',
          minutes,
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await api(mod, '', {
        action: 'moderate',
        id: a,
        mode: 'blocked',
        reason: '',
        minutes: null,
      })
    ).status,
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
      'moderation.png',
      { type: 'image/png' },
    ),
  );
  const up = await fetch(base + '/api/upload', {
    method: 'POST',
    headers: auth(a),
    body: form,
  });
  assert.equal(up.status, 200);
  const media = await up.json();
  // Unpublished uploads are private; moderation still applies after publication.
  assert.equal(
    (await fetch(base + media.url, { headers: auth(b) })).status,
    404,
  );
  const image = await fetch(base + media.url, { headers: auth(a) });
  assert.equal(image.status, 200);
  assert.match(image.headers.get('cache-control'), /no-store/);
  await image.arrayBuffer();
  const channel = await ok(a, '', {
    action: 'createChannel',
    name: 'Author channel',
    handle: 'mod_ch_' + run,
    bio: 'Hidden channel',
  });
  const searchAccounts = async (params) =>
    ok(
      mod,
      '?' + new URLSearchParams({ action: 'moderationUsers', ...params }),
    );
  for (const q of [
    channel.handle,
    '  @' + channel.handle.toUpperCase() + '  ',
  ]) {
    const found = (await searchAccounts({ q })).people;
    assert.equal(found.length, 1);
    assert.equal(found[0].id, channel.id);
    assert.equal(found[0].kind, 'channel');
    assert.equal(found[0].ownerId, a);
    assert.equal(found[0].ownerHandle, (await account(a)).handle);
    assert.equal(found[0].canRestrict, true);
  }
  for (const id of [mod, 'noctgram']) {
    const found = (await searchAccounts({ id })).people;
    assert.equal(found.length, 1, 'Protected accounts remain discoverable');
    assert.equal(found[0].id, id);
    assert.equal(found[0].canRestrict, false);
  }
  assert.ok(
    (await searchAccounts({ q: '@noctgram' })).people.some(
      (p) => p.id === 'noctgram',
    ),
  );
  assert.deepEqual((await searchAccounts({ id: 'missing_' + run })).people, []);
  assert.deepEqual(
    (await searchAccounts({ q: '%' })).people,
    [],
    'SQL wildcards are literal',
  );
  const alias = 'alias_' + run,
    main = 'main_' + run;
  await ok(a, '', { action: 'handle', handle: alias });
  await ok(a, '', { action: 'handle', handle: main });
  const aliasMatch = (
    await searchAccounts({ q: '  @' + alias.toUpperCase() + '  ' })
  ).people;
  assert.equal(aliasMatch.length, 1);
  assert.equal(aliasMatch[0].id, a);
  assert.equal(aliasMatch[0].handle, main);
  assert.equal(aliasMatch[0].canRestrict, true);
  assert.equal(
    (await searchAccounts({ q: String(run) })).people.filter((p) => p.id === a)
      .length,
    1,
    'Multiple matching handles must not duplicate accounts',
  );
  const firstPage = await searchAccounts({ q: '' });
  if (firstPage.hasMore) {
    assert.equal(firstPage.people.length, 30);
    const nextPage = await searchAccounts({ after: firstPage.nextCursor });
    assert.ok(nextPage.people.length > 0);
    assert.ok(
      nextPage.people.every(
        (p) => !firstPage.people.some((x) => x.id === p.id),
      ),
    );
  }
  const ap = await post(a, '#hiddenmod' + run + ' hidden_post', undefined, [
    media.id,
  ]);
  created.push([a, ap.id]);
  const cp = await post(a, 'channel_hidden_' + run, channel.id);
  created.push([a, cp.id]);
  const bp = await post(b, 'visible_post_' + run);
  created.push([b, bp.id]);
  await ok(a, '', {
    action: 'comment',
    id: bp.id,
    text: 'hidden_comment_' + run,
  });
  await ok(a, '', { action: 'follow', id: b, value: true });
  await ok(b, '', { action: 'follow', id: a, value: true });
  await ok(a, '', { action: 'message', id: b, text: 'hidden_message_' + run });
  await ok(b, '', {
    action: 'message',
    id: c,
    text: 'unrelated_secret_' + run,
  });
  await ok(b, '', { action: 'report', id: ap.id, reason: 'QA report' });
  await ok(b, '', { action: 'report', id: cp.id, reason: 'QA channel report' });
  const reportRows = await ok(mod, '?action=moderationReports');
  const channelReport = reportRows.find((r) => r.postId === cp.id);
  assert.equal(channelReport.kind, 'channel');
  const channelAuthor = await searchAccounts({
    id: channelReport.authorId,
    q: 'stale_handle',
    after: 'zzz',
  });
  assert.equal(
    channelAuthor.people[0].id,
    channel.id,
    'Author ID takes precedence over search and pagination',
  );
  const personReport = reportRows.find((r) => r.postId === ap.id);
  const renamed = 'renamed_' + run;
  await ok(a, '', { action: 'handle', handle: renamed });
  const reportAuthor = await searchAccounts({
    id: personReport.authorId,
    q: personReport.handle,
  });
  assert.equal(reportAuthor.people[0].id, a);
  assert.equal(reportAuthor.people[0].handle, renamed);
  assert.ok(
    (await ok(mod, '?action=moderationReports')).some(
      (r) => r.postId === ap.id,
    ),
  );
  await moderate(a, 'read_only', 'QA read only', 60);
  let own = await account(a);
  assert.equal(own.restriction.mode, 'read_only');
  assert.ok(own.restriction.expiresAt > Date.now());
  const external = await ok(b, '?action=profile&id=' + a);
  assert.equal(external.name, 'Author');
  assert.equal(external.restriction, undefined);
  assert.equal(external.canModerate, undefined);
  assert.equal(external.blocked, undefined);
  assert.ok((await ok(a, '?action=feed')).some((p) => p.id === ap.id));
  assert.ok((await ok(a, '?action=messages&peer=' + b)).length);
  const actions = [
    'post',
    'createChannel',
    'profile',
    'handle',
    'removeHandle',
    'comment',
    'deleteComment',
    'like',
    'save',
    'vote',
    'follow',
    'message',
    'pin',
    'hide',
    'report',
    'delete',
    'support',
  ];
  for (const action of actions) {
    const r = await api(a, '', {
      action,
      id: bp.id,
      text: 'forbidden',
      value: true,
    });
    assert.equal(r.status, 403, action);
    assert.equal(r.data.code, 'READ_ONLY', action);
  }
  assert.equal(
    (
      await fetch(base + '/api/upload', {
        method: 'POST',
        headers: auth(a),
        body: form,
      })
    ).status,
    403,
  );
  await account(a);
  await ok(a, '', { action: 'view', id: bp.id });
  await ok(a, '', { action: 'appeal', text: 'Please review read-only' });
  const oldAppeal = (await account(a)).appeal;
  assert.equal(oldAppeal.status, 'pending');
  await moderate(a, 'blocked', 'QA blocked');
  own = await account(a);
  assert.equal(own.restriction.mode, 'blocked');
  assert.equal(own.restriction.expiresAt, null);
  assert.equal(
    (await searchAccounts({ q: renamed })).people[0].mode,
    'blocked',
  );
  assert.equal(
    (await searchAccounts({ q: channel.handle })).people[0].id,
    channel.id,
  );
  const blockedBootstrap = await ok(a, '?action=bootstrap');
  assert.deepEqual(blockedBootstrap.posts, []);
  assert.deepEqual(blockedBootstrap.people, []);
  for (const q of [
    '?action=feed',
    '?action=profile&id=' + b,
    '?action=messages&peer=' + b,
    '?action=people',
    '?action=channels',
  ]) {
    const r = await api(a, q);
    assert.equal(r.status, 403, q);
    assert.equal(r.data.code, 'ACCOUNT_BLOCKED');
  }
  const hiddenProfile = await ok(b, '?action=profile&id=' + a);
  assert.equal(hiddenProfile.blocked, true);
  assert.equal(hiddenProfile.avatar, '');
  assert.equal(hiddenProfile.bio, '');
  assert.equal(hiddenProfile.name, 'Аккаунт заблокирован');
  assert.equal(hiddenProfile.restriction, undefined);
  assert.equal(hiddenProfile.reason, undefined);
  assert.equal((await ok(b, '?action=profile&id=' + channel.id)).blocked, true);
  for (const id of [ap.id, cp.id])
    assert.equal((await api(b, '?action=post&id=' + id)).status, 404);
  const feed = await ok(b, '?action=feed');
  assert.ok(!feed.some((p) => p.userId === a || p.userId === channel.id));
  assert.equal(feed.find((p) => p.id === bp.id).comments, 0);
  assert.deepEqual(await ok(b, '?action=comments&post=' + bp.id), []);
  assert.ok(
    !(await ok(b, '?action=topics')).some((t) => t.tag === '#hiddenmod' + run),
  );
  assert.ok(!(await ok(b, '?action=people&q=Author')).some((p) => p.id === a));
  assert.ok(
    !(await ok(b, '?action=channels&q=' + channel.handle)).some(
      (p) => p.id === channel.id,
    ),
  );
  assert.equal(
    (await api(b, '?action=connections&id=' + a + '&kind=followers')).status,
    403,
  );
  assert.ok(
    !(
      await ok(c, '?action=connections&id=' + b + '&kind=followers')
    ).people.some((p) => p.id === a),
  );
  assert.equal((await ok(b, '?action=profile')).followers, 0);
  assert.ok(!(await ok(b, '?action=threads')).some((p) => p.id === a));
  assert.equal((await api(b, '?action=messages&peer=' + a)).status, 403);
  assert.equal(
    (await api(b, '', { action: 'message', id: a, text: 'no' })).status,
    403,
  );
  assert.equal(
    (await api(b, '', { action: 'follow', id: a, value: true })).status,
    403,
  );
  assert.equal(
    (await api(b, '', { action: 'comment', id: ap.id, text: 'no' })).status,
    404,
  );
  assert.equal(
    (await fetch(base + media.url, { headers: auth(b) })).status,
    404,
  );
  await account(b);
  assert.equal(
    (await api(a, '', { action: 'post', text: 'no' })).data.code,
    'ACCOUNT_BLOCKED',
  );
  const exported = await ok(a, '?action=exportAccount');
  assert.equal(exported.profile.id, a);
  assert.ok(exported.posts.some((p) => p.id === ap.id));
  assert.ok(!JSON.stringify(exported).includes('unrelated_secret_' + run));
  assert.equal(
    (
      await api(b, '', {
        action: 'reviewAppeal',
        id: oldAppeal.id,
        decision: 'accepted',
        note: 'forged',
      })
    ).status,
    403,
  );
  await ok(mod, '', {
    action: 'reviewAppeal',
    id: oldAppeal.id,
    decision: 'accepted',
    note: 'Old appeal accepted',
  });
  assert.equal(
    (await account(a)).restriction.mode,
    'blocked',
    'Old appeal must not lift newer block',
  );
  await ok(a, '', { action: 'appeal', text: 'Please review block' });
  await ok(a, '', { action: 'appeal', text: 'Duplicate overwrite attempt' });
  const newAppeal = (await account(a)).appeal;
  assert.equal(newAppeal.text, 'Please review block');
  await ok(mod, '', {
    action: 'reviewAppeal',
    id: newAppeal.id,
    decision: 'dismissed',
    note: 'Decision confirmed',
  });
  assert.equal((await account(a)).appeal.reviewNote, 'Decision confirmed');
  assert.equal(
    (
      await api(mod, '', {
        action: 'reviewAppeal',
        id: newAppeal.id,
        decision: 'accepted',
        note: 'repeat',
      })
    ).status,
    409,
  );
  await moderate(a, 'active', 'Block lifted');
  assert.equal((await account(a)).restriction, null);
  assert.equal((await ok(b, '?action=profile&id=' + a)).blocked, undefined);
  assert.ok((await ok(b, '?action=feed')).some((p) => p.id === ap.id));
  assert.ok(
    (await ok(b, '?action=messages&peer=' + a)).some(
      (m) => m.text === 'hidden_message_' + run,
    ),
  );
  assert.equal(
    (await fetch(base + media.url, { headers: auth(b) })).status,
    200,
  );
  const history = await ok(mod, '?action=moderationHistory&id=' + a);
  assert.ok(history.some((e) => e.mode === 'blocked'));
  assert.ok(history.some((e) => e.mode === 'active'));
  assert.ok(history.every((e) => e.moderatorId === mod));
  assert.equal((await account('mod_qa_expired')).restriction, null);
  await ok('mod_qa_expired', '?action=feed');
  await moderate(a, 'read_only', 'Appeal can lift current restriction');
  await ok(a, '', { action: 'appeal', text: 'Current restriction appeal' });
  const currentAppeal = (await account(a)).appeal;
  await ok(mod, '', {
    action: 'reviewAppeal',
    id: currentAppeal.id,
    decision: 'accepted',
    note: 'Restriction lifted on review',
  });
  assert.equal((await account(a)).restriction, null);
  assert.equal((await account(a)).appeal.status, 'accepted');
  console.log(
    'PASS: channel/alias/protected-account search, report author lookup by ID after renaming, search pagination and permissions, moderator-only access and anti-escalation, protected moderators, reasons/expiry, read-only mutation/upload guards, blocked profiles/posts/channels/comments/relations/messages/media, own export isolation, appeal idempotency/review/newer-decision protection, audit history and unblock restoration.',
  );
} finally {
  await moderate(a, 'active', 'QA cleanup');
  for (const [u, id] of created) await api(u, '', { action: 'delete', id });
}
