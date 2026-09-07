import assert from 'node:assert/strict';

// Only run against the isolated local production Worker, never a deployed site.
const base = 'http://127.0.0.1:8787';
const runId = Date.now();
const owner = 'design_owner_' + runId;
const reader = 'design_reader_' + runId;
async function api(user, query = '', body) {
  const r = await fetch(base + '/api/social' + query, {
    headers: {
      'oai-authenticated-user-id': user,
      'oai-authenticated-user-email': user + '@example.com',
      'Content-Type': 'application/json',
    },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
const posts = [];
const tag = 'redesign_' + runId;
try {
  for (const user of [owner, reader]) {
    const result = await api(user, '?action=bootstrap');
    assert.equal(result.status, 200);
    assert.ok(result.data.me.lastSeen > 0);
  }
  for (let i = 0; i < 32; i++) {
    assert.equal(
      (
        await api(owner, '', {
          action: 'post',
          text: tag + '_' + i + ' #' + tag,
          poll: i === 0 ? ['Первый', 'Второй'] : [],
        })
      ).status,
      200,
    );
  }
  const first = (await api(owner, '?action=feed&q=' + tag)).data;
  assert.equal(first.length, 30);
  posts.push(...first);
  const cursor = first.at(-1);
  const rest = (
    await api(
      owner,
      '?action=feed&q=' +
        tag +
        '&before=' +
        cursor.created +
        '&afterId=' +
        cursor.id,
    )
  ).data;
  posts.push(...rest);
  assert.equal(posts.length, 32);
  assert.equal(
    new Set(posts.map((p) => p.id)).size,
    32,
    'Feed cursor has no duplicated or missing posts',
  );
  const a = posts[0],
    b = posts[1];
  assert.equal(
    (await api(reader, '', { action: 'pin', id: a.id, value: true })).status,
    403,
  );
  await api(owner, '', { action: 'pin', id: a.id, value: true });
  await api(owner, '', { action: 'pin', id: b.id, value: true });
  assert.equal((await api(owner, '?action=profile')).data.pinnedPostId, b.id);
  assert.equal((await api(owner, '?action=post&id=' + a.id)).data.pinned, 0);
  assert.equal((await api(owner, '?action=post&id=' + b.id)).data.pinned, 1);

  for (let i = 0; i < 55; i++) {
    const result = await api(reader, '', {
      action: 'comment',
      id: a.id,
      text: 'Комментарий ' + i,
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.userId, reader);
    assert.equal(result.data.text, 'Комментарий ' + i);
    assert.ok(result.data.id);
  }
  const recent = (await api(owner, '?action=comments&post=' + a.id)).data;
  assert.equal(recent.length, 50);
  assert.equal(
    recent.at(-1).text,
    'Комментарий 54',
    'Newest comment is visible without loading older pages',
  );
  const older = (
    await api(
      owner,
      '?action=comments&post=' +
        a.id +
        '&before=' +
        recent[0].created +
        '&beforeId=' +
        recent[0].id,
    )
  ).data;
  assert.equal(older.length, 5);
  assert.equal(new Set([...recent, ...older].map((c) => c.id)).size, 55);
  assert.equal(
    (await api(owner, '', { action: 'deleteComment', id: recent[0].id }))
      .status,
    403,
  );
  assert.equal(
    (await api(reader, '', { action: 'deleteComment', id: recent[0].id }))
      .status,
    200,
  );
  assert.equal((await api(owner, '?action=post&id=' + a.id)).data.comments, 54);

  await api(reader, '', { action: 'hide', id: a.id, value: true });
  assert.ok(
    !(await api(reader, '?action=feed&q=' + tag)).data.some(
      (p) => p.id === a.id,
    ),
  );
  assert.ok(
    (await api(owner, '?action=feed&q=' + tag)).data.some((p) => p.id === a.id),
    'Hiding is personal',
  );
  await api(reader, '', { action: 'hide', id: a.id, value: false });
  assert.ok(
    (await api(reader, '?action=feed&q=' + tag)).data.some(
      (p) => p.id === a.id,
    ),
  );
  assert.equal(
    (await api(owner, '', { action: 'report', id: a.id, reason: 'Own post' }))
      .status,
    400,
  );
  assert.equal(
    (await api(reader, '', { action: 'report', id: a.id, reason: '' })).status,
    400,
  );
  assert.equal(
    (
      await api(reader, '', {
        action: 'report',
        id: a.id,
        reason: 'Локальная тестовая жалоба',
      })
    ).status,
    200,
  );
  assert.ok(
    (await api(reader, '?action=topics')).data.some(
      (t) => t.tag === '#' + tag && t.count === 32,
    ),
  );
  assert.deepEqual(
    (await api(owner, '?action=feed&user=' + owner + '&media=1')).data,
    [],
  );

  const handle = 'u' + String(runId).padStart(23, '0');
  assert.equal(handle.length, 24);
  assert.equal(
    (await api(owner, '', { action: 'handle', handle: '@' + handle })).status,
    200,
  );
  assert.equal((await api(owner, '?action=profile')).data.handle, handle);
  console.log(
    'PASS: paginated feed and recent comments, returned comments, delete permissions, one profile pin, personal hiding/undo, reports, real topics, media filter, presence and 24-character usernames.',
  );
} finally {
  for (let page = 0; page < 3; page++) {
    const result = await api(owner, '?action=feed&user=' + owner + '&q=' + tag);
    if (result.status !== 200 || !result.data.length) break;
    for (const post of result.data)
      await api(owner, '', { action: 'delete', id: post.id });
  }
}
