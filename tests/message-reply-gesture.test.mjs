import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/message-reply-gesture.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const {
  createMessageReplyGesture,
  isMessageReplyTarget,
  replyShift,
  repliesOnRelease,
} = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

function fixture(t) {
  let now = 1000,
    replies = 0,
    enabled = true,
    cleared = 0,
    selection = null;
  class Element {
    constructor(tag = 'div', parent = null, attrs = {}) {
      this.tag = tag;
      this.parent = parent;
      this.attrs = new Map(Object.entries(attrs));
      this.properties = new Map();
      this.style = {
        setProperty: (name, value) => this.properties.set(name, value),
        removeProperty: (name) => this.properties.delete(name),
      };
      this.captured = null;
    }
    matches(selector) {
      if (selector.startsWith('[')) {
        const [, name, value] = selector.match(
          /^\[([^=\]]+)(?:="([^"]*)")?\]$/,
        );
        return value === undefined
          ? this.attrs.has(name)
          : this.attrs.get(name) === value;
      }
      const [tag, className] = selector.split('.');
      return (
        (!tag || this.tag === tag) &&
        (!className ||
          (this.attrs.get('class') || '').split(' ').includes(className))
      );
    }
    closest(selector) {
      for (let current = this; current; current = current.parent)
        if (selector.split(',').some((part) => current.matches(part)))
          return current;
      return null;
    }
    contains(target) {
      for (let current = target; current; current = current.parent)
        if (current === this) return true;
      return false;
    }
    setAttribute(name, value) {
      this.attrs.set(name, value);
    }
    removeAttribute(name) {
      this.attrs.delete(name);
    }
    toggleAttribute(name, enabled) {
      if (enabled) this.attrs.set(name, '');
      else this.attrs.delete(name);
    }
    setPointerCapture(id) {
      this.captured = id;
    }
    hasPointerCapture(id) {
      return this.captured === id;
    }
    releasePointerCapture() {
      this.captured = null;
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Element');
  Object.defineProperty(globalThis, 'Element', {
    configurable: true,
    value: Element,
  });
  t.mock.method(Date, 'now', () => now);
  const root = new Element();
  root.ownerDocument = { getSelection: () => selection };
  const text = new Element('p', root);
  const controller = createMessageReplyGesture({
    enabled: () => enabled,
    reply: () => replies++,
  });
  const event = (extra = {}) => ({
    target: text,
    currentTarget: root,
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: 200,
    clientY: 100,
    timeStamp: now,
    detail: 1,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    cancelable: true,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    ...extra,
  });
  const call = (name, extra) => {
    const next = event(extra);
    const result = controller[name](next);
    return { ...next, result };
  };
  t.after(() => {
    controller.cancel();
    if (original) Object.defineProperty(globalThis, 'Element', original);
    else delete globalThis.Element;
  });
  return {
    root,
    text,
    controller,
    call,
    child: (tag, attrs = {}, parent = root) => new Element(tag, parent, attrs),
    portal: () => new Element('p'),
    allow(value) {
      enabled = value;
    },
    advance(ms) {
      now += ms;
    },
    select(anchorNode = text, focusNode = text) {
      selection = { anchorNode, focusNode, removeAllRanges: () => cleared++ };
    },
    get replies() {
      return replies;
    },
    get cleared() {
      return cleared;
    },
    clean() {
      assert.equal(root.captured, null);
      assert.equal(root.attrs.has('data-reply-dragging'), false);
      assert.equal(root.attrs.has('data-reply-ready'), false);
      assert.equal(root.properties.size, 0);
    },
    // The first move decides; tracking starts there, so drag as far again.
    swipe(dx = -64, dy = 0, extra = {}) {
      call('onPointerDown', extra);
      const move = call('onPointerMove', {
        clientX: 200 + dx,
        clientY: 100 + dy,
        ...extra,
      });
      call('onPointerMove', {
        clientX: 200 + 2 * dx,
        clientY: 100 + 2 * dy,
        ...extra,
      });
      const up = call('onPointerUp', {
        clientX: 200 + 2 * dx,
        clientY: 100 + 2 * dy,
        ...extra,
      });
      return { move, up };
    },
    doubleClick(extra = {}) {
      call('onPointerDown', { pointerType: 'mouse', ...extra });
      call('onClickCapture', extra);
      call('onPointerDown', { pointerType: 'mouse', ...extra });
      call('onClickCapture', { detail: 2, ...extra });
      return call('onDoubleClick', { detail: 2, ...extra });
    },
  };
}

await test('left swipe replies once at 64 px and restores the message after release', (t) => {
  const f = fixture(t);
  assert.equal(
    f.call('onPointerDown').prevented,
    false,
    'Touch begins without preventing scrolling',
  );
  assert.equal(f.root.captured, null, 'A tap does not capture the pointer');
  f.call('onPointerMove', { clientX: 188 });
  assert.equal(f.root.captured, 1);
  assert.equal(
    f.root.properties.get('--reply-shift'),
    '0px',
    'Taking the gesture does not jump by the threshold',
  );
  f.call('onPointerMove', { clientX: 125 });
  assert.equal(f.root.attrs.has('data-reply-ready'), false);
  assert.equal(f.replies, 0, 'Moving never submits a reply');
  f.call('onPointerMove', { clientX: 124 });
  assert.equal(f.root.attrs.has('data-reply-ready'), true);
  assert.equal(f.root.properties.get('--reply-progress'), '1');
  const up = f.call('onPointerUp', { clientX: 124 });
  assert.equal(up.prevented, true);
  assert.equal(f.replies, 1);
  f.clean();
  f.call('onPointerUp', { clientX: 124 });
  assert.equal(f.replies, 1, 'A duplicate release cannot reply twice');
});

await test('past 64 px the message resists instead of stopping hard', (t) => {
  const f = fixture(t);
  assert.equal(replyShift(40), 40);
  assert.equal(replyShift(64), 64);
  assert.ok(replyShift(88) > 64 && replyShift(88) < 88);
  assert.ok(replyShift(400) > replyShift(200));
  assert.ok(replyShift(10000) < 64 + 48);
  f.call('onPointerDown');
  f.call('onPointerMove', { clientX: 188 });
  f.call('onPointerMove', { clientX: 68 });
  const shift = parseFloat(f.root.properties.get('--reply-shift'));
  assert.ok(shift < -64 && shift > -120, String(shift));
  f.call('onPointerUp', { clientX: 68 });
  assert.equal(f.replies, 1);
  f.clean();
});

await test('release velocity carries a short flick and a flick back cancels', (t) => {
  assert.equal(repliesOnRelease(64, 0), true);
  assert.equal(repliesOnRelease(63, 0), false);
  assert.equal(repliesOnRelease(28, -900), true, 'Projected past 64 px');
  assert.equal(repliesOnRelease(90, 200), false, 'Moving back toward start');
  assert.equal(repliesOnRelease(140, 120), true, 'A slow drift back far out');
  const f = fixture(t);
  f.call('onPointerDown');
  f.advance(10);
  f.call('onPointerMove', { clientX: 188 });
  f.advance(16);
  f.call('onPointerMove', { clientX: 160 });
  f.call('onPointerUp', { clientX: 160 });
  assert.equal(f.replies, 1, 'A fast 28 px flick replies');
  f.clean();
  f.advance(501);
  f.call('onPointerDown');
  f.call('onPointerMove', { clientX: 188 });
  f.advance(100);
  f.call('onPointerMove', { clientX: 90 });
  f.advance(20);
  f.call('onPointerMove', { clientX: 110 });
  f.call('onPointerUp', { clientX: 110 });
  assert.equal(f.replies, 1, 'Flicking back past 64 px cancels');
  f.clean();
});

await test('short, rightward, vertical and diagonal gestures cannot reply', (t) => {
  const f = fixture(t);
  for (const [dx, dy] of [
    [-8, 0],
    [-63, 0],
    [70, 0],
    [0, 80],
    [-30, 60],
  ]) {
    const { move, up } = f.swipe(dx, dy);
    assert.equal(f.replies, 0, `${dx},${dy} must not reply`);
    if (dx >= 0 || Math.abs(dy) > Math.abs(dx)) {
      assert.equal(
        move.prevented,
        false,
        'Vertical/right movement remains native',
      );
      assert.equal(up.prevented, false);
    }
    f.clean();
  }
  f.call('onPointerDown');
  f.call('onPointerMove', { clientY: 120 });
  f.call('onPointerMove', { clientX: 100 });
  f.call('onPointerUp', { clientX: 100 });
  assert.equal(
    f.replies,
    0,
    'A vertical scroll cannot change into a reply midway',
  );
  f.call('onPointerDown');
  f.call('onPointerMove', { clientX: 100 });
  f.call('onPointerUp', { clientX: 170 });
  assert.equal(
    f.replies,
    0,
    'Pulling back below the threshold cancels the reply',
  );
  f.clean();
});

await test('pointer cancellation, capture loss and another finger cancel a ready swipe', (t) => {
  const f = fixture(t);
  for (const cancel of [
    () => f.call('onPointerCancel'),
    () => f.call('onLostPointerCapture', { target: f.root }),
    () => f.call('onPointerDown', { pointerId: 2, isPrimary: false }),
    () => f.controller.cancel(),
  ]) {
    f.call('onPointerDown');
    f.call('onPointerMove', { clientX: 100 });
    cancel();
    f.call('onPointerUp', { clientX: 100 });
    assert.equal(f.replies, 0);
    f.clean();
  }
  f.call('onPointerDown');
  f.call('onPointerMove', { clientX: 100, pointerId: 2 });
  f.call('onPointerUp', { clientX: 100, pointerId: 2 });
  assert.equal(f.replies, 0, 'An unrelated pointer cannot finish the gesture');
});

await test('transferring implicit touch capture from a descendant does not cancel the row swipe', (t) => {
  const f = fixture(t);
  const photo = f.child('button', { class: 'chat-photo' });
  const target = f.child('img', {}, photo);
  f.call('onPointerDown', { target });
  f.call('onPointerMove', { target, clientX: 175 });
  assert.equal(f.root.captured, 1);
  f.call('onLostPointerCapture', { target });
  assert.equal(
    f.root.captured,
    1,
    'The old descendant capture loss bubbles through the row',
  );
  f.call('onLostPointerCapture', { target: f.root, pointerId: 2 });
  assert.equal(
    f.root.captured,
    1,
    'Another pointer cannot cancel this capture',
  );
  f.call('onPointerMove', { target: f.root, clientX: 110 });
  f.call('onPointerUp', { target: f.root, clientX: 110 });
  assert.equal(f.replies, 1);
  f.clean();
  f.advance(501);
  f.call('onPointerDown', { target });
  f.call('onPointerMove', { target, clientX: 120 });
  f.call('onLostPointerCapture', { target: f.root });
  f.call('onPointerUp', { target: f.root, clientX: 120 });
  assert.equal(f.replies, 1, 'Losing the active row capture still cancels');
  f.clean();
});

await test('controls, media, exempt descendants and portals keep their own interactions', (t) => {
  const f = fixture(t);
  const targets = [
    ...[
      'a',
      'button',
      'input',
      'textarea',
      'select',
      'video',
      'audio',
      'iframe',
    ].map((tag) => f.child(tag)),
    f.child('div', { contenteditable: 'true' }),
    ...['button', 'slider', 'menu'].map((role) => f.child('div', { role })),
    f.child('div', { 'data-chat-menu-exempt': '' }),
    f.child('div', { 'data-chat-removing': '' }),
    f.portal(),
    null,
  ];
  targets.push(f.child('svg', {}, targets[1]));
  for (const target of targets) {
    assert.equal(isMessageReplyTarget(target, f.root), false);
    assert.equal(isMessageReplyTarget(target, f.root, true), false);
    const { move, up } = f.swipe(-80, 0, { target });
    assert.equal(move.prevented, false);
    assert.equal(up.prevented, false);
    assert.equal(f.doubleClick({ target }).prevented, false);
    f.clean();
  }
  assert.equal(f.replies, 0);
});

await test('photo swipes suppress the compatibility click while stationary taps still open the photo', (t) => {
  const f = fixture(t);
  const photo = f.child('button', { class: 'chat-photo' });
  const target = f.child('img', {}, photo);
  assert.equal(isMessageReplyTarget(target, f.root), false);
  assert.equal(isMessageReplyTarget(target, f.root, true), true);
  f.call('onPointerDown', { target });
  f.call('onPointerUp', { target });
  const tap = f.call('onClickCapture', { target });
  assert.equal(
    tap.prevented,
    false,
    'A stationary photo tap reaches its viewer callback',
  );
  assert.equal(tap.result, false);
  f.swipe(-80, 0, { target });
  assert.equal(f.replies, 1);
  const click = f.call('onClickCapture', { target });
  assert.equal(click.prevented, true);
  assert.equal(click.stopped, true);
  assert.equal(
    click.result,
    true,
    'A completed swipe cannot also open the viewer',
  );
  const portal = f.call('onClickCapture', { target: f.portal() });
  assert.equal(
    portal.prevented,
    false,
    'Suppression does not cross a React portal',
  );
  f.advance(501);
  assert.equal(
    f.call('onClickCapture', { target }).prevented,
    false,
    'Suppression expires',
  );
  assert.equal(f.doubleClick({ target }).prevented, false);
  assert.equal(f.replies, 1, 'Desktop photo clicks remain viewer interactions');
});

await test('permissions are checked at gesture start, movement, release and double click', (t) => {
  const f = fixture(t);
  f.allow(false);
  f.swipe();
  f.doubleClick();
  assert.equal(f.replies, 0);
  f.allow(true);
  f.call('onPointerDown');
  f.call('onPointerMove', { clientX: 100 });
  f.allow(false);
  f.call('onPointerUp', { clientX: 100 });
  f.clean();
  f.allow(true);
  f.call('onPointerDown');
  f.allow(false);
  f.call('onPointerMove', { clientX: 100 });
  f.allow(true);
  f.call('onPointerUp', { clientX: 100 });
  f.clean();
  f.advance(501);
  f.call('onPointerDown', { pointerType: 'mouse' });
  f.allow(false);
  f.call('onClickCapture');
  f.allow(true);
  f.call('onDoubleClick', { detail: 2 });
  assert.equal(
    f.replies,
    0,
    'Deselecting the last selected message on click cannot turn into a reply',
  );
  f.call('onClickCapture');
  f.allow(false);
  f.call('onDoubleClick', { detail: 2 });
  assert.equal(f.replies, 0);
});

await test('desktop text double click replies, clears only its own word selection, and ignores modifiers', (t) => {
  const f = fixture(t);
  f.call('onPointerDown', { pointerType: 'mouse' });
  f.call('onClickCapture');
  assert.equal(f.replies, 0, 'A single click never replies');
  f.select();
  assert.equal(f.doubleClick().prevented, true);
  assert.equal(f.replies, 1);
  assert.equal(f.cleared, 1);
  f.select(f.text, f.portal());
  f.doubleClick();
  assert.equal(f.replies, 2);
  assert.equal(
    f.cleared,
    1,
    'A selection extending outside this message remains intact',
  );
  for (const extra of [
    ...['ctrlKey', 'metaKey', 'altKey', 'shiftKey'].map((key) => ({
      [key]: true,
    })),
    { button: 2 },
  ])
    assert.equal(f.doubleClick(extra).prevented, false);
  assert.equal(f.replies, 2);
});

await test('touch double taps and touch-generated double clicks never start a reply', (t) => {
  const f = fixture(t);
  for (let detail = 1; detail <= 2; detail++) {
    f.call('onPointerDown');
    f.call('onPointerUp');
    assert.equal(f.call('onClickCapture', { detail }).prevented, false);
  }
  assert.equal(f.call('onDoubleClick', { detail: 2 }).prevented, false);
  assert.equal(f.replies, 0);
  f.doubleClick();
  assert.equal(
    f.replies,
    1,
    'A later real mouse double click still works on hybrid devices',
  );
});

await test('committed permission changes cancel immediately and new replies use the current callback', (t) => {
  const f = fixture(t);
  let latestReplies = 0;
  f.call('onPointerDown');
  f.call('onPointerMove', { clientX: 100 });
  f.controller.configure({
    enabled: () => false,
    reply: () => latestReplies++,
  });
  f.clean();
  f.controller.configure({ enabled: () => true, reply: () => latestReplies++ });
  f.call('onPointerUp', { clientX: 100 });
  assert.equal(
    latestReplies,
    0,
    'Reenabling cannot revive the cancelled gesture',
  );
  f.advance(501);
  f.doubleClick();
  assert.equal(latestReplies, 1);
  assert.equal(f.replies, 0, 'The original callback is no longer invoked');
  f.call('onPointerDown', { pointerType: 'mouse' });
  f.call('onClickCapture');
  f.controller.configure({
    enabled: () => false,
    reply: () => latestReplies++,
  });
  f.controller.configure({ enabled: () => true, reply: () => latestReplies++ });
  f.call('onDoubleClick', { detail: 2 });
  assert.equal(
    latestReplies,
    1,
    'Changing permissions also cancels a pending desktop double click',
  );
});
