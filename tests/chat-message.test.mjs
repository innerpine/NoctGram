import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['app/chat-message.tsx'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  plugins: [
    {
      name: 'message-boundaries',
      setup(build) {
        build.onResolve(
          {
            filter:
              /^\.\/(chat-gift|profile-link|profile-identity|music-link-card|chat-message-files|chat-message-menu)$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents:
            'export const Avatar="Avatar", ChatGift="ChatGift", MentionText="MentionText", ProfileLink="ProfileLink", MusicLinkCard="MusicLinkCard", ChatMessageFiles="ChatMessageFiles", ChatMessageContext="ChatMessageContext";',
        }));
      },
    },
  ],
});
// Bare package imports in a data URL cannot resolve; use the same React runtime
// through a minimal memo boundary, since this component has no local hooks.
const moduleText = compiled.outputFiles[0].text;
const second = await build({
  stdin: { contents: moduleText, resolveDir: process.cwd() },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { ChatMessage } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(second.outputFiles[0].text).toString('base64')
);
const me = { id: 'alice', name: 'Alice' },
  peer = { id: 'bob', name: 'Bob' };
const profiles = [],
  miniProfiles = [],
  pinned = [];
const props = {
  me,
  peer,
  onProfile: (id) => profiles.push(id),
  onAvatar: (id) => miniProfiles.push(id),
  onAction: (action, message) => {
    if (action === 'pin') pinned.push(message.id);
  },
  onJump: (id) => profiles.push('jump:' + id),
  disabled: false,
  canSend: true,
  selected: false,
  selecting: false,
};
const message = {
  id: 'm1',
  sender: 'bob',
  recipient: 'alice',
  text: '@alice https://soundcloud.com/test/song',
  created: 100000,
  read: 0,
};
const context = ChatMessage.type({ ...props, message });
assert.equal(context.type, 'ChatMessageContext');
const row = context.props.children;
const [avatar, rendered] = row.props.children;
assert.equal(avatar.type, 'button');
assert.equal(avatar.props['aria-haspopup'], 'dialog');
avatar.props.onClick();
assert.deepEqual(miniProfiles, ['bob']);
assert.deepEqual(
  profiles,
  [],
  'Opening the mini-profile does not navigate away',
);
assert.equal(avatar.props.children.props.person, peer);
assert.equal(rendered.props.className, 'bubble other');
const content = rendered.props.children;
const caption = content.find((child) => child?.type === 'p');
const musicScope = content.find(
  (child) => child?.props?.['data-chat-menu-exempt'] === true,
);
const music = musicScope.props.children;
const footer = content.find(
  (child) => child?.props?.className === 'message-time',
);
assert.equal(caption.props.children.props.text, message.text);
assert.equal(
  music.props.text,
  message.text,
  'Music link handling stays attached to the original text',
);
assert.equal(footer.props.children[0].type, 'time');
assert.equal(
  footer.props.children[0].props.dateTime,
  new Date(message.created).toISOString(),
);
assert.equal(
  footer.props.children.some((child) => child?.type === 'button'),
  false,
);
const outgoing = ChatMessage.type({
  ...props,
  message: { ...message, sender: 'alice', read: 1 },
}).props.children.props.children[1];
assert.equal(outgoing.props.className, 'bubble self');
const ownAvatar = ChatMessage.type({
  ...props,
  message: { ...message, sender: me.id },
}).props.children.props.children[0];
ownAvatar.props.onClick();
assert.equal(ownAvatar.props.children.props.person, me);
assert.deepEqual(miniProfiles, ['bob', 'alice']);
assert.equal(
  outgoing.props.children
    .find((child) => child?.props?.className === 'message-time')
    .props.children.at(-1).props['aria-label'],
  'Прочитано',
  'Own messages retain their read status',
);
const gift = ChatMessage.type({
  ...props,
  message: {
    ...message,
    gift: { id: 'g1', giftId: 'toy_bear', price: 25, message: '' },
  },
}).props.children;
assert.equal(gift.type, 'ChatGift');
assert.equal(gift.props.peer, peer);
assert.equal(gift.props.onAvatar, props.onAvatar);
gift.props.onProfile('bob');
assert.deepEqual(profiles, ['bob']);
assert.equal(gift.props.actions, undefined);
assert.equal(gift.props.onReport, undefined);
const files = [
  { id: 'photo', kind: 'image', name: 'Фото.png', type: 'image/png', size: 50 },
];
const fileMessage = ChatMessage.type({
  ...props,
  message: { ...message, text: '', attachments: files },
}).props.children.props.children[1];
assert.equal(fileMessage.props.id, 'chat-message-m1');
assert.match(fileMessage.props.className, /chat-media-only/);
const media = fileMessage.props.children.find(
  (child) => child?.type === 'ChatMessageFiles',
);
assert.equal(media.props.flush, true);
assert.equal(media.props.metadata.props.className, 'message-time');
assert.equal(
  fileMessage.props.children.some(
    (child) => child?.props?.className === 'message-time',
  ),
  false,
  'Bare media shows its timestamp only over the attachment',
);
for (const attachment of [files[0], { ...files[0], kind: 'video' }]) {
  const captioned = ChatMessage.type({
    ...props,
    message: { ...message, text: 'Подпись', attachments: [attachment] },
  }).props.children.props.children[1];
  assert.match(captioned.props.className, /chat-media-message/);
  assert.doesNotMatch(captioned.props.className, /chat-media-only/);
  assert.equal(
    captioned.props.children.find((child) => child?.type === 'p').props.children
      .props.text,
    'Подпись',
  );
  assert.equal(
    captioned.props.children.find((child) => child?.type === 'ChatMessageFiles')
      .props.metadata,
    undefined,
  );
}
const document = ChatMessage.type({
  ...props,
  message: {
    ...message,
    text: '',
    attachments: [{ ...files[0], kind: 'file' }],
  },
}).props.children.props.children[1];
assert.doesNotMatch(document.props.className, /chat-media-message/);
assert.equal(
  fileMessage.props.children.find((child) => child?.type === 'ChatMessageFiles')
    .props.files,
  files,
);
assert.equal(
  fileMessage.props.children.some((child) => child?.type === 'p'),
  false,
);
context.props.onAction('pin', context.props.message);
assert.deepEqual(pinned, ['m1']);
const quoted = ChatMessage.type({
  ...props,
  message: {
    ...message,
    forwardedName: 'Автор',
    reply: {
      id: 'older',
      sender: 'alice',
      name: 'Alice',
      text: 'Цитата',
      unavailable: false,
    },
  },
}).props.children.props.children[1];
const quote = quoted.props.children.find(
  (child) => child?.props?.className === 'chat-reply-quote',
);
quote.props.onClick();
assert.equal(profiles.at(-1), 'jump:older');
assert.equal(
  quoted.props.children.find(
    (child) => child?.props?.className === 'chat-forwarded',
  ).props.children[1].props.children,
  'Автор',
);
console.log(
  'Chat rendering: sender avatars, compact timestamps, read indicators, mentions/music, gift routing and context actions preserved.',
);

const attributed = ChatMessage.type({
  ...props,
  message: { ...message, forwardedName: 'Alice', forwardedSender: 'alice' },
}).props.children.props.children[1];
const author = attributed.props.children.find(
  (child) => child?.props?.className === 'chat-forwarded',
).props.children[1].props.children;
assert.equal(author.type, 'ProfileLink');
assert.deepEqual(author.props.target, { id: 'alice' });
assert.equal(author.props.children, 'Alice');
