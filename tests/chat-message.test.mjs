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
              /^\.\/(chat-gift|profile-link|music-link-card|chat-message-files|chat-message-menu)$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents:
            'export const ChatGift="ChatGift", MentionText="MentionText", ProfileLink="ProfileLink", MusicLinkCard="MusicLinkCard", ChatMessageFiles="ChatMessageFiles", ChatMessageMenu="ChatMessageMenu", ChatMessageContext="ChatMessageContext";',
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
const reported = [],
  profiles = [],
  pinned = [];
const props = {
  me,
  peer,
  onReport: (message) => reported.push(message.id),
  onProfile: (id) => profiles.push(id),
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
const rendered = context.props.children;
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
footer.props.children[0].props.onClick();
assert.deepEqual(reported, ['m1']);
const outgoing = ChatMessage.type({
  ...props,
  message: { ...message, sender: 'alice', read: 1 },
}).props.children;
assert.equal(outgoing.props.className, 'bubble self');
assert.equal(
  outgoing.props.children.find(
    (child) => child?.props?.className === 'message-time',
  ).props.children[0],
  false,
  'Own messages do not get a report button',
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
gift.props.onProfile('bob');
gift.props.onReport();
assert.deepEqual(profiles, ['bob']);
assert.deepEqual(reported, ['m1', 'm1']);
const files = [
  { id: 'photo', kind: 'image', name: 'Фото.png', type: 'image/png', size: 50 },
];
const fileMessage = ChatMessage.type({
  ...props,
  message: { ...message, text: '', attachments: files },
}).props.children;
assert.equal(fileMessage.props.id, 'chat-message-m1');
assert.equal(
  fileMessage.props.children.find((child) => child?.type === 'ChatMessageFiles')
    .props.files,
  files,
);
assert.equal(
  fileMessage.props.children.some((child) => child?.type === 'p'),
  false,
);
const menu = footer.props.children.find(
  (child) => child?.type === 'ChatMessageMenu',
);
menu.props.onAction('pin', menu.props.message);
assert.deepEqual(pinned, ['m1']);
assert.equal(gift.props.actions.type, 'ChatMessageMenu');
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
}).props.children;
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
  'Chat rendering: own/incoming messages, read indicators, mentions/music, gift routing and report/profile callbacks preserved.',
);

const attributed = ChatMessage.type({
  ...props,
  message: { ...message, forwardedName: 'Alice', forwardedSender: 'alice' },
}).props.children;
const author = attributed.props.children.find(
  (child) => child?.props?.className === 'chat-forwarded',
).props.children[1].props.children;
assert.equal(author.type, 'ProfileLink');
assert.deepEqual(author.props.target, { id: 'alice' });
assert.equal(author.props.children, 'Alice');
