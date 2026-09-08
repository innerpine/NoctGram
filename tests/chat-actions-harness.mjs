import assert from 'node:assert/strict';

export async function checkChatActions(
  api,
  sqlite,
  { upload, send, media, failNextNotification },
) {
  const status = (code) => (error) => error.status === code;
  const count = (table) =>
    Number(sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
  const row = (id) =>
    sqlite.prepare('SELECT * FROM messages WHERE id=?').get(id);
  const inChat = async (me, peer, id, focus = '') =>
    (await api.readConversation(me, peer, focus)).find(
      (message) => message.id === id,
    );
  const remove = (me, peer, ids, everyone) =>
    api.deleteMessages(me, { peer, ids, everyone });
  let sequence = 0;
  const forwardBody = (ids, extra = {}) => ({
    ids,
    peer: 'alice',
    recipient: 'carol',
    key: `forward-test-${String(++sequence).padStart(8, '0')}`,
    ...extra,
  });
  sqlite.exec(
    "INSERT INTO users(id,name,created) VALUES('dave','Dave',1); DELETE FROM message_pins",
  );
  assert.deepEqual(
    api
      .sortedPins([
        { id: 'old', created: 100, pinnedAt: 300 },
        { id: 'new', created: 200, pinnedAt: 150 },
        { id: 'none', created: 500, pinnedAt: null },
      ])
      .map((message) => message.id),
    ['new', 'old'],
    'Pin order follows send time, not pin time',
  );

  const source = await send([], 'Исходный текст');
  const replyKey = 'reply-request-fixed-0001';
  const response = await api.sendPrivateMessage(
    'bob',
    'alice',
    'Ответ',
    [],
    replyKey,
    source.id,
  );
  const reply = await inChat('alice', 'bob', response.id, response.id);
  assert.deepEqual(reply.reply, {
    id: source.id,
    sender: 'alice',
    name: 'Alice',
    text: 'Исходный текст',
    unavailable: false,
  });
  assert.deepEqual(
    await api.sendPrivateMessage(
      'bob',
      'alice',
      'Ответ',
      [],
      replyKey,
      source.id,
    ),
    response,
  );
  await assert.rejects(
    api.sendPrivateMessage('bob', 'alice', 'Ответ', [], replyKey, null),
    status(409),
  );
  await assert.rejects(
    api.sendPrivateMessage(
      'carol',
      'bob',
      'Поддельная цитата',
      [],
      crypto.randomUUID(),
      source.id,
    ),
    status(403),
  );
  await assert.rejects(
    api.editMessage('bob', {
      id: source.id,
      peer: 'alice',
      text: 'Подмена',
      revision: 0,
    }),
    status(403),
  );
  await assert.rejects(
    api.editMessage('alice', {
      id: source.id,
      peer: 'bob',
      text: '',
      revision: 0,
    }),
    status(400),
  );
  await api.editMessage('alice', {
    id: source.id,
    peer: 'bob',
    text: 'Исправленный текст',
    revision: 0,
  });
  assert.ok(row(source.id).editedAt);
  assert.equal(
    (await inChat('bob', 'alice', response.id, response.id)).reply.text,
    'Исправленный текст',
  );
  await api.editMessage('alice', {
    id: source.id,
    peer: 'bob',
    text: 'Исправленный текст',
    revision: 0,
  });
  await assert.rejects(
    api.editMessage('alice', {
      id: source.id,
      peer: 'bob',
      text: 'Старая вкладка',
      revision: 0,
    }),
    status(409),
  );
  const revision = row(source.id).editedAt;
  const racingEdits = await Promise.allSettled(
    ['Первое изменение', 'Второе изменение'].map((text) =>
      api.editMessage('alice', { id: source.id, peer: 'bob', text, revision }),
    ),
  );
  assert.equal(
    racingEdits.filter((result) => result.status === 'fulfilled').length,
    1,
    'Concurrent editors cannot silently overwrite one another',
  );

  sqlite.prepare('UPDATE messages SET created=1 WHERE id=?').run(source.id);
  assert.equal(await inChat('alice', 'bob', source.id), undefined);
  assert.ok(
    await inChat('alice', 'bob', source.id, source.id),
    'Reply navigation can load a source older than the history window',
  );
  assert.equal(
    await inChat('carol', 'bob', source.id, source.id),
    undefined,
    'Focus IDs never widen conversation access',
  );
  await api.pinMessage('alice', { id: source.id, peer: 'bob', value: true });
  await remove('bob', 'alice', [source.id], false);
  assert.ok(await inChat('alice', 'bob', source.id));
  assert.equal(await inChat('bob', 'alice', source.id, source.id), undefined);
  assert.equal(
    (await inChat('bob', 'alice', response.id, response.id)).reply.unavailable,
    true,
  );
  assert.equal(
    (await inChat('alice', 'bob', response.id, response.id)).reply.unavailable,
    false,
  );
  await assert.rejects(
    api.pinMessage('bob', { id: source.id, peer: 'alice', value: true }),
    status(403),
  );
  await assert.rejects(
    api.sendPrivateMessage(
      'bob',
      'alice',
      'Ответ на скрытое',
      [],
      crypto.randomUUID(),
      source.id,
    ),
    status(403),
  );
  await assert.rejects(
    api.forwardMessages('bob', forwardBody([source.id])),
    status(403),
  );
  await remove('alice', 'bob', [source.id], true);
  assert.equal(await inChat('alice', 'bob', source.id, source.id), undefined);
  assert.equal(
    (await inChat('alice', 'bob', response.id, response.id)).reply.unavailable,
    true,
  );
  assert.equal(count('message_pins'), 0);
  await remove('alice', 'bob', [source.id], true);
  await assert.rejects(
    api.editMessage('alice', {
      id: source.id,
      peer: 'bob',
      text: 'Вернуть',
      revision: row(source.id).editedAt,
    }),
    status(403),
  );

  const attachment = await upload();
  const fileMessage = await send([attachment.id], 'Подпись');
  await api.editMessage('alice', {
    id: fileMessage.id,
    peer: 'bob',
    text: '',
    revision: 0,
  });
  assert.equal(row(fileMessage.id).text, '');
  assert.equal(
    JSON.parse(row(fileMessage.id).media)[0].id,
    attachment.id,
    'Editing a caption retains attachments',
  );
  const textMessage = await send([], 'Второе сообщение');
  assert.equal((await media(attachment.id, 'carol')).status, 404);
  failNextNotification();
  const failedForward = forwardBody([fileMessage.id, textMessage.id]);
  const beforeRollback = [count('messages'), count('notifications')];
  await assert.rejects(
    api.forwardMessages('bob', failedForward),
    /Notification storage failed/,
  );
  assert.deepEqual([count('messages'), count('notifications')], beforeRollback);
  assert.equal(
    (await media(attachment.id, 'carol')).status,
    404,
    'A failed forward cannot grant file access',
  );
  const [forwarded, duplicate] = await Promise.all([
    api.forwardMessages('bob', failedForward),
    api.forwardMessages('bob', failedForward),
  ]);
  assert.deepEqual(duplicate, forwarded);
  assert.deepEqual(
    [count('messages'), count('notifications')],
    beforeRollback.map((n) => n + 2),
  );
  assert.deepEqual(
    forwarded.ids.map((id) => row(id).forwardSourceId),
    [fileMessage.id, textMessage.id],
  );
  assert.equal(row(forwarded.ids[0]).forwardedName, 'Alice');
  assert.equal(
    (await inChat('carol', 'bob', forwarded.ids[0])).forwardedSender,
    'alice',
  );
  assert.equal(row(forwarded.ids[0]).giftReceiptId, null);
  assert.equal((await media(attachment.id, 'carol')).status, 200);
  assert.equal((await media(attachment.id, 'dave')).status, 404);
  await assert.rejects(
    api.forwardMessages('bob', { ...failedForward, recipient: 'dave' }),
    status(409),
  );
  await assert.rejects(
    api.forwardMessages('bob', {
      ...failedForward,
      ids: [textMessage.id, fileMessage.id],
    }),
    status(409),
  );
  await assert.rejects(
    api.editMessage('bob', {
      id: forwarded.ids[0],
      peer: 'carol',
      text: 'Fake author',
      revision: 0,
    }),
    status(403),
  );
  await assert.rejects(
    api.sendPrivateMessage('carol', 'dave', '', [attachment.id]),
    status(403),
    'Direct send cannot forge a forward grant',
  );
  const forwardedAgain = await api.forwardMessages(
    'carol',
    forwardBody([forwarded.ids[0]], { peer: 'bob', recipient: 'dave' }),
  );
  assert.equal(
    row(forwardedAgain.ids[0]).forwardedName,
    'Alice',
    'Repeated forwarding keeps original attribution',
  );
  assert.equal((await media(attachment.id, 'dave')).status, 200);
  assert.equal(
    (await inChat('dave', 'carol', forwardedAgain.ids[0])).forwardedSender,
    'alice',
    'Profile attribution survives repeated forwarding',
  );
  await remove('dave', 'carol', forwardedAgain.ids, true);
  assert.equal((await media(attachment.id, 'dave')).status, 404);
  await remove('alice', 'bob', [fileMessage.id], true);
  assert.equal(
    (await inChat('carol', 'bob', forwarded.ids[0])).forwardedSender,
    'alice',
    'Original author remains linkable after the original is deleted',
  );
  assert.equal(
    (await media(attachment.id, 'alice')).status,
    404,
    'Deleting the original revokes access where no surviving copy exists',
  );
  assert.equal(
    (await media(attachment.id, 'bob')).status,
    200,
    'An independently forwarded copy remains available to its participants',
  );
  assert.equal((await media(attachment.id, 'carol')).status, 200);
  await remove('carol', 'bob', forwarded.ids, true);
  assert.equal((await media(attachment.id, 'bob')).status, 404);
  assert.equal((await media(attachment.id, 'carol')).status, 404);
  await assert.rejects(
    api.forwardMessages('bob', forwardBody([fileMessage.id])),
    status(403),
  );

  const privateMessage = await send([], 'Другая переписка', 'carol', 'dave');
  const beforeForbidden = count('messages');
  await assert.rejects(
    api.forwardMessages(
      'bob',
      forwardBody([textMessage.id, privateMessage.id]),
    ),
    status(403),
  );
  assert.equal(
    count('messages'),
    beforeForbidden,
    'One forbidden source rejects the entire batch',
  );
  await assert.rejects(
    remove('bob', 'alice', [textMessage.id, privateMessage.id], true),
    status(403),
  );
  assert.equal(
    row(textMessage.id).deletedAt,
    0,
    'Mixed-conversation deletion is rejected as a whole',
  );
  await assert.rejects(
    api.forwardMessages(
      'bob',
      forwardBody(Array.from({ length: 21 }, (_, i) => 'x' + i)),
    ),
    status(400),
  );
  sqlite.exec(
    "INSERT INTO user_blocks(blocker,blocked,created) VALUES('carol','bob',1)",
  );
  await assert.rejects(
    api.forwardMessages('bob', forwardBody([textMessage.id])),
    status(403),
  );
  sqlite.exec('DELETE FROM user_blocks');
  sqlite.exec(
    "INSERT INTO user_privacy(userId,messagePolicy) VALUES('carol','nobody')",
  );
  await assert.rejects(
    api.forwardMessages('bob', forwardBody([textMessage.id])),
    status(403),
  );
  sqlite.exec('DELETE FROM user_privacy');
  sqlite.exec(
    "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('alice','restriction','read_only','fixture',1)",
  );
  await assert.rejects(
    remove('alice', 'bob', [textMessage.id], false),
    status(403),
  );
  await assert.rejects(
    api.editMessage('alice', {
      id: textMessage.id,
      peer: 'bob',
      text: 'Не разрешено',
      revision: 0,
    }),
    status(403),
  );
  await assert.rejects(
    api.forwardMessages(
      'alice',
      forwardBody([textMessage.id], { peer: 'bob' }),
    ),
    status(403),
  );
  sqlite.exec('DELETE FROM account_restrictions');

  const gift = await api.sendGift('alice', {
    recipient: 'bob',
    giftId: 'toy_bear',
    message: 'Подарок для теста',
    key: crypto.randomUUID(),
  });
  const giftMessage = sqlite
    .prepare('SELECT id FROM messages WHERE giftReceiptId=?')
    .get(gift.id).id;
  const financialState = [count('received_gifts'), count('star_transfers')];
  const giftForward = await api.forwardMessages(
    'bob',
    forwardBody([giftMessage]),
  );
  assert.equal(row(giftForward.ids[0]).giftReceiptId, null);
  assert.match(row(giftForward.ids[0]).text, /Подарок для теста/);
  await api.pinMessage('bob', { id: giftMessage, peer: 'alice', value: true });
  await remove('bob', 'alice', [giftMessage], true);
  assert.deepEqual(
    [count('received_gifts'), count('star_transfers')],
    financialState,
    'Forwarding or deleting a gift event cannot buy, duplicate or revoke a gift',
  );
  assert.equal(
    sqlite.prepare('SELECT 1 FROM notifications WHERE targetId=?').get(gift.id),
    undefined,
  );
  assert.equal(
    sqlite
      .prepare('SELECT 1 FROM message_pins WHERE messageId=?')
      .get(giftMessage),
    undefined,
  );
  console.log(
    'Chat actions: send-time pins, replies/focus, concurrent edits, private/all deletion, atomic forwards, file grants, privacy and gift invariants passed.',
  );
}
