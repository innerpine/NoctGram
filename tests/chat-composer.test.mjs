import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Invoke real component callbacks with controlled requests; no browser or chat writes.
let active;
globalThis.__composerHooks = {
  useState(initial) {
    const owner = active,
      index = owner.cursor++;
    if (owner.first) owner.slots[index] = initial;
    return [
      owner.slots[index],
      (value) => {
        owner.slots[index] = value;
      },
    ];
  },
  useRef(initial) {
    const owner = active,
      index = owner.cursor++;
    if (owner.first) owner.slots[index] = { current: initial };
    return owner.slots[index];
  },
  useEffect(effect) {
    active.cursor++;
    if (active.first) active.effects.push(effect);
  },
};
const { outputFiles } = await build({
  entryPoints: ['app/chat-composer.tsx'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  plugins: [
    {
      name: 'composer-hooks',
      setup(build) {
        build.onResolve({ filter: /^\.\/premium-emoji$/ }, () => ({
          path: 'emoji',
          namespace: 'fixture-emoji',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture-emoji' }, () => ({
          contents:
            'export const EmojiPicker=()=>null,EmojiPreview=()=>null,EmojiText=({text})=>text;',
        }));
        build.onResolve(
          { filter: /^(react(?:\/jsx-runtime)?|lucide-react)$/ },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'react'
              ? 'export const {useState,useRef,useEffect}=globalThis.__composerHooks; export const useLayoutEffect=useEffect;'
              : path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx;'
                : 'export const File="File", LoaderCircle="LoaderCircle", Paperclip="Paperclip", RotateCcw="RotateCcw", Send="Send", Video="Video", X="X", Reply="Reply";',
        }));
      },
    },
  ],
});
const { ChatComposer } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const previousFetch = globalThis.fetch;
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const createURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
  revokeURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: new EventTarget(),
});
const previews = new Set(),
  revoked = new Set(),
  calls = [],
  uploads = [],
  deleted = [];
let serial = 0,
  responseMode = 'success';
URL.createObjectURL = () => {
  const url = 'blob:fixture-' + ++serial;
  previews.add(url);
  return url;
};
URL.revokeObjectURL = (url) => revoked.add(url);
globalThis.fetch = async (url, init) => {
  if (url === '/api/chat-upload' && init.method === 'DELETE') {
    deleted.push(JSON.parse(init.body).id);
    return Response.json({ ok: true });
  }
  if (url === '/api/chat-upload') {
    let resolve, reject;
    const promise = new Promise((a, b) => {
      resolve = a;
      reject = b;
    });
    const file = init.body.get('file');
    const attachment = {
      id: 'uploaded-' + ++serial,
      kind: 'image',
      name: file.name,
      size: file.size,
      type: file.type,
    };
    uploads.push({
      peer: init.body.get('peer'),
      signal: init.signal,
      attachment,
      finish: () => resolve(Response.json(attachment)),
      fail: () => reject(new TypeError('Соединение прервано')),
    });
    return promise;
  }
  assert.equal(url, '/api/social');
  calls.push(JSON.parse(init.body));
  if (responseMode === 'lost') throw new TypeError('Failed to fetch');
  if (responseMode === 'rejected')
    return new Response('<html>Denied</html>', { status: 413 });
  return Response.json({ id: 'sent' });
};
const flush = async () => {
  for (let i = 0; i < 4; i++)
    await new Promise((resolve) => setImmediate(resolve));
};
function flatten(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];
}
const mounted = [];
function mount(peerId = 'bob') {
  const owner = {
    first: true,
    slots: [],
    effects: [],
    cursor: 0,
    sent: 0,
    edits: [],
    disposed: false,
  };
  const props = {
    peerId,
    text: '',
    disabled: false,
    onText: (text) => {
      props.text = text;
      owner.edits.push(text);
    },
    onSent: () => owner.sent++,
  };
  owner.render = () => {
    active = owner;
    owner.cursor = 0;
    const tree = ChatComposer(props);
    if (owner.first) {
      owner.first = false;
      owner.cleanup = owner.effects.map((effect) => effect());
    }
    return tree;
  };
  owner.nodes = () => flatten(owner.render());
  owner.find = (predicate) => owner.nodes().find(predicate);
  owner.pick = (files) =>
    owner
      .find((n) => n.type === 'input')
      .props.onChange({ target: { files, value: 'selected' } });
  owner.submit = () =>
    owner
      .find((n) => n.type === 'form')
      .props.onSubmit({ preventDefault() {} });
  owner.textarea = () => owner.find((n) => n.type === 'textarea').props;
  owner.button = (label) =>
    owner.find((n) => n.props?.['aria-label'] === label)?.props;
  owner.props = props;
  owner.dispose = () => {
    if (!owner.disposed) {
      owner.cleanup.forEach((cleanup) => cleanup?.());
      owner.disposed = true;
    }
  };
  owner.render();
  mounted.push(owner);
  return owner;
}
const photo = (name) =>
  new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])],
    name,
    { type: 'image/png' },
  );
try {
  const keyboard = mount();
  let coarse = true,
    submissions = 0,
    prevented = 0;
  window.matchMedia = () => ({ matches: coarse });
  const enter = (extra = {}) =>
    keyboard.textarea().onKeyDown({
      key: 'Enter',
      shiftKey: false,
      nativeEvent: { isComposing: false },
      preventDefault: () => prevented++,
      currentTarget: { form: { requestSubmit: () => submissions++ } },
      ...extra,
    });
  enter();
  assert.equal(submissions, 0, 'Mobile Return keeps native newline insertion');
  assert.equal(prevented, 0);
  enter({ ctrlKey: true });
  assert.equal(
    submissions,
    1,
    'An external mobile keyboard can explicitly submit',
  );
  coarse = false;
  enter();
  assert.equal(submissions, 2, 'Desktop Enter still submits');
  enter({ shiftKey: true });
  enter({ nativeEvent: { isComposing: true } });
  assert.equal(submissions, 2, 'Shift+Enter and IME composition are preserved');
  keyboard.dispose();
  const compose = mount();
  compose.pick([photo('one.png'), photo('two.png')]);
  assert.equal(uploads.length, 1, 'A selection uploads sequentially');
  assert.equal(compose.button('Отправить сообщение').disabled, true);
  uploads[0].finish();
  await flush();
  assert.equal(uploads.length, 2);
  uploads[1].finish();
  await flush();
  assert.equal(
    compose.button('Отправить сообщение').disabled,
    false,
    'No caption is required',
  );
  compose.submit();
  compose.submit();
  await flush();
  assert.equal(calls.length, 1, 'A rapid double submit sends once');
  assert.deepEqual(
    calls[0].attachments,
    uploads.slice(0, 2).map((u) => u.attachment.id),
  );
  assert.equal(calls[0].text, '');
  assert.equal(compose.sent, 1);
  assert.equal(compose.button('Убрать one.png'), undefined);
  compose.dispose();
  await flush();
  assert.equal(
    deleted.length,
    0,
    'Successful uploads are no longer draft cleanup candidates',
  );

  const removal = mount();
  removal.pick([photo('removed.png')]);
  const removing = uploads.at(-1);
  removal.button('Убрать removed.png').onClick();
  assert.equal(removing.signal.aborted, true);
  removing.finish();
  await flush();
  assert.ok(
    deleted.includes(removing.attachment.id),
    'A late upload response is discarded after removal',
  );
  assert.equal(removal.button('Убрать removed.png'), undefined);
  removal.dispose();

  const retryUpload = mount();
  retryUpload.pick([photo('retry.png')]);
  uploads.at(-1).fail();
  await flush();
  assert.ok(retryUpload.button('Повторить загрузку retry.png'));
  assert.equal(retryUpload.button('Отправить сообщение').disabled, true);
  retryUpload.button('Повторить загрузку retry.png').onClick();
  uploads.at(-1).finish();
  await flush();
  assert.equal(retryUpload.button('Отправить сообщение').disabled, false);
  const retained = uploads.at(-1).attachment.id;
  retryUpload.dispose();
  await flush();
  assert.ok(
    deleted.includes(retained),
    'Leaving a chat removes uploaded, unsent drafts',
  );

  const oldPeer = mount('bob');
  oldPeer.pick([photo('old-chat.png'), photo('queued.png')]);
  const oldUpload = uploads.at(-1),
    requestsBeforeSwitch = uploads.length;
  oldPeer.dispose();
  const newPeer = mount('carol');
  oldUpload.finish();
  await flush();
  assert.equal(oldUpload.signal.aborted, true);
  assert.equal(
    uploads.length,
    requestsBeforeSwitch,
    'Unmounted composers do not upload queued files',
  );
  assert.ok(deleted.includes(oldUpload.attachment.id));
  assert.equal(newPeer.button('Убрать old-chat.png'), undefined);
  assert.deepEqual(
    newPeer.edits,
    [],
    'A late result cannot clear the next conversation draft',
  );
  newPeer.dispose();

  const uncertain = mount();
  uncertain.props.text = 'Не потеряй это сообщение';
  uncertain.props.reply = { id: 'reply-original', name: 'Bob', text: 'Цитата' };
  responseMode = 'lost';
  uncertain.submit();
  await flush();
  const lostBody = calls.at(-1);
  assert.equal(lostBody.replyTo, 'reply-original');
  assert.ok(uncertain.button('Отменить ответ').disabled);
  assert.equal(
    uncertain.textarea().disabled,
    true,
    'An uncertain request is immutable until retried',
  );
  assert.equal(uncertain.button('Повторить отправку').disabled, false);
  uncertain.pick([photo('must-not-add.png')]);
  assert.equal(uncertain.button('Убрать must-not-add.png'), undefined);
  responseMode = 'success';
  uncertain.submit();
  await flush();
  assert.deepEqual(
    calls.at(-1),
    lostBody,
    'Retry sends the identical idempotency key, text and attachment IDs',
  );
  assert.equal(uncertain.sent, 1);
  assert.equal(uncertain.props.text, '');
  uncertain.dispose();

  const rejected = mount();
  rejected.props.text = 'Не отправилось';
  responseMode = 'rejected';
  rejected.submit();
  await flush();
  const rejectedKey = calls.at(-1).key;
  assert.equal(
    rejected.textarea().disabled,
    false,
    'A non-JSON definitive 4xx restores editing',
  );
  rejected.props.text = 'Исправленное сообщение';
  responseMode = 'success';
  rejected.submit();
  await flush();
  assert.notEqual(calls.at(-1).key, rejectedKey);
  assert.equal(calls.at(-1).text, 'Исправленное сообщение');
  rejected.dispose();
  assert.deepEqual(revoked, previews, 'All preview object URLs are released');
  console.log(
    'Chat composer: upload queue, remove/retry, conversation switch, cleanup, double submit and immutable network retry passed.',
  );
} finally {
  mounted.forEach((owner) => owner.dispose());
  globalThis.fetch = previousFetch;
  if (previousWindow)
    Object.defineProperty(globalThis, 'window', previousWindow);
  else delete globalThis.window;
  Object.defineProperty(URL, 'createObjectURL', createURL);
  Object.defineProperty(URL, 'revokeObjectURL', revokeURL);
  delete globalThis.__composerHooks;
}
