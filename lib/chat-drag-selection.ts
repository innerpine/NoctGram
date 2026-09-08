const CONTENT =
  '.bubble,.chat-gift-event,button,a,input,textarea,select,[contenteditable],video,audio,iframe,[data-chat-menu-exempt],[data-chat-removing],[role="menu"]';

export function isChatSelectionSurface(
  target: EventTarget | null,
  list: HTMLElement,
) {
  return (
    target instanceof Element &&
    list.contains(target) &&
    !target.closest(CONTENT)
  );
}
export function chatDragSpeed(y: number, top: number, bottom: number) {
  const edge = Math.min(56, (bottom - top) / 3);
  if (edge <= 0) return 0;
  if (y < top + edge) return -900 * Math.min(1, (top + edge - y) / edge) ** 2;
  if (y > bottom - edge)
    return 900 * Math.min(1, (y - bottom + edge) / edge) ** 2;
  return 0;
}

/** A mouse gesture can start only in the gutter. Message contents keep native selection. */
export function createChatDragSelection(
  list: HTMLElement,
  hooks: {
    selected: () => readonly string[];
    select: (ids: string[]) => void;
    start: () => void;
    limit: () => void;
  },
) {
  const host = list.ownerDocument.defaultView!;
  let frame = 0,
    clickTimer = 0,
    suppressClick = false;
  let gesture: {
    pointer: number;
    x: number;
    y: number;
    origin: number;
    currentY: number;
    baseline: string[];
    restore: string[];
    dragging: boolean;
    warned: boolean;
    time: number;
  } | null = null;
  const rows = () =>
    Array.from(
      list.querySelectorAll<HTMLElement>(
        ':scope > [data-chat-message-id]:not([data-chat-removing])',
      ),
    );
  const position = (y: number) =>
    y - list.getBoundingClientRect().top - list.clientTop + list.scrollTop;
  const assign = (next: string[]) => {
    const previous = hooks.selected();
    if (
      next.length !== previous.length ||
      next.some((id) => !previous.includes(id))
    )
      hooks.select(next);
  };
  const selectRange = () => {
    const active = gesture;
    if (!active?.dragging) return;
    const end = position(active.currentY),
      low = Math.min(active.origin, end),
      high = Math.max(active.origin, end);
    const bounds = list.getBoundingClientRect();
    const offset = list.scrollTop - bounds.top - list.clientTop;
    const currentRows = rows();
    const available = new Set(
      currentRows.map((row) => row.dataset.chatMessageId!),
    );
    let range = currentRows
      .filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom + offset >= low && rect.top + offset <= high;
      })
      .map((row) => row.dataset.chatMessageId!);
    if (end < active.origin) range = range.reverse();
    const next = [
      ...new Set([
        ...active.baseline.filter((id) => available.has(id)),
        ...range,
      ]),
    ];
    if (next.length > 20 && !active.warned) {
      active.warned = true;
      hooks.limit();
    }
    assign(next.slice(0, 20));
  };
  const tick = (now: number) => {
    frame = 0;
    const active = gesture;
    if (!active?.dragging) return;
    const bounds = list.getBoundingClientRect();
    const top = bounds.top + list.clientTop;
    const speed = chatDragSpeed(active.currentY, top, top + list.clientHeight);
    const before = list.scrollTop;
    const step = (speed * Math.min(32, Math.max(0, now - active.time))) / 1000;
    active.time = now;
    if (step)
      list.scrollTo({
        top: Math.max(
          0,
          Math.min(before + step, list.scrollHeight - list.clientHeight),
        ),
        behavior: 'instant',
      });
    selectRange();
    if (speed && list.scrollTop !== before) frame = requestAnimationFrame(tick);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const start = () => {
    if (!gesture || gesture.dragging) return;
    gesture.dragging = true;
    // Capturing on pointerdown retargets even a stationary click to the list,
    // bypassing the message's full-row selection handler.
    list.setPointerCapture(gesture.pointer);
    gesture.time = performance.now();
    hooks.start();
    list.ownerDocument.getSelection()?.removeAllRanges();
    list.setAttribute('data-chat-dragging', '');
  };
  const wheel = (event: WheelEvent) => {
    if (gesture && event.deltaY) {
      start();
      schedule();
    }
  };
  const scroll = () => {
    if (gesture?.dragging) schedule();
  };
  const finish = (restore = false) => {
    const active = gesture;
    if (!active) return;
    gesture = null;
    cancelAnimationFrame(frame);
    frame = 0;
    list.removeAttribute('data-chat-dragging');
    if (list.hasPointerCapture(active.pointer))
      list.releasePointerCapture(active.pointer);
    host.removeEventListener('blur', cancel);
    host.removeEventListener('pointermove', move);
    host.removeEventListener('pointerup', up);
    host.removeEventListener('pointercancel', cancel);
    host.removeEventListener('keydown', keydown, true);
    list.ownerDocument.removeEventListener('visibilitychange', hidden);
    if (restore && active.dragging) assign(active.restore);
    if (active.dragging) {
      suppressClick = true;
      host.clearTimeout(clickTimer);
      clickTimer = host.setTimeout(() => {
        suppressClick = false;
      }, 0);
    }
  };
  const cancel = () => finish();
  const hidden = () => {
    if (list.ownerDocument.hidden) finish();
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && gesture) {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    }
  };
  const down = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      event.pointerType !== 'mouse' ||
      !isChatSelectionSurface(event.target, list) ||
      !rows().length
    )
      return;
    const bounds = list.getBoundingClientRect();
    const left = bounds.left + list.clientLeft,
      top = bounds.top + list.clientTop;
    // Leave scrollbar dragging to the browser.
    if (
      event.clientX < left ||
      event.clientX >= left + list.clientWidth ||
      event.clientY < top ||
      event.clientY >= top + list.clientHeight
    )
      return;
    finish();
    host.clearTimeout(clickTimer);
    suppressClick = false;
    const selected = [...hooks.selected()];
    gesture = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      origin: position(event.clientY),
      currentY: event.clientY,
      baseline:
        event.ctrlKey || event.metaKey || event.shiftKey ? selected : [],
      restore: selected,
      dragging: false,
      warned: false,
      time: performance.now(),
    };
    event.preventDefault();
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', cancel);
    host.addEventListener('blur', cancel);
    host.addEventListener('keydown', keydown, true);
    list.ownerDocument.addEventListener('visibilitychange', hidden);
  };
  const move = (event: PointerEvent) => {
    const active = gesture;
    if (!active || active.pointer !== event.pointerId) return;
    if (!(event.buttons & 1)) {
      finish();
      return;
    }
    active.currentY = event.clientY;
    if (
      !active.dragging &&
      Math.hypot(event.clientX - active.x, event.clientY - active.y) >= 5
    ) {
      start();
    }
    if (active.dragging) {
      event.preventDefault();
      schedule();
    }
  };
  const up = (event: PointerEvent) => {
    if (gesture?.pointer !== event.pointerId) return;
    gesture.currentY = event.clientY;
    selectRange();
    finish();
  };
  const click = (event: MouseEvent) => {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  list.addEventListener('pointerdown', down);
  list.addEventListener('lostpointercapture', cancel);
  list.addEventListener('click', click, true);
  list.addEventListener('wheel', wheel, { passive: true });
  list.addEventListener('scroll', scroll, { passive: true });
  return {
    get dragging() {
      return !!gesture?.dragging;
    },
    dispose() {
      finish();
      host.clearTimeout(clickTimer);
      list.removeEventListener('pointerdown', down);
      list.removeEventListener('lostpointercapture', cancel);
      list.removeEventListener('click', click, true);
      list.removeEventListener('wheel', wheel);
      list.removeEventListener('scroll', scroll);
    },
  };
}
