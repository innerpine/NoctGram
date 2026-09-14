const CONTROLS =
  'a,button,input,textarea,select,[contenteditable],[role="button"],[role="slider"],video,audio,iframe,[data-chat-menu-exempt],[data-chat-removing],[role="menu"]';
const TOUCH_CONTROLS = CONTROLS.replace('button,', '');
const THRESHOLD = 64;

export function isMessageReplyTarget(
  target: EventTarget | null,
  root: HTMLElement,
  touch = false,
) {
  if (!(target instanceof Element) || !root.contains(target)) return false;
  // A swipe over a photo replies; a stationary tap still opens its viewer.
  if (touch && target.closest('button.chat-photo'))
    return !target.closest(TOUCH_CONTROLS);
  return !target.closest(CONTROLS);
}

type Pointer = {
  target: EventTarget | null;
  currentTarget: HTMLElement;
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  button: number;
  clientX: number;
  clientY: number;
  cancelable: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
};
type Click = Pick<
  Pointer,
  'target' | 'currentTarget' | 'button' | 'preventDefault' | 'stopPropagation'
> & {
  detail: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** Per-message controller: no global listeners; touch cancellation keeps native scrolling. */
type ReplyOptions = { enabled: () => boolean; reply: () => void };

export function createMessageReplyGesture(hooks: ReplyOptions) {
  let active: {
    id: number;
    x: number;
    y: number;
    root: HTMLElement;
    dragging: boolean;
  } | null = null;
  let lastInput = 'mouse',
    firstClick = false,
    suppressUntil = 0;
  const reset = () => {
    const previous = active;
    active = null;
    if (!previous) return;
    previous.root.removeAttribute('data-reply-dragging');
    previous.root.removeAttribute('data-reply-ready');
    previous.root.style.removeProperty('--reply-shift');
    previous.root.style.removeProperty('--reply-progress');
    if (previous.root.hasPointerCapture?.(previous.id))
      previous.root.releasePointerCapture(previous.id);
  };
  const cancel = () => {
    firstClick = false;
    reset();
  };
  const modified = (event: Click) =>
    event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
  return {
    configure: (next: ReplyOptions) => {
      hooks = next;
      if (!hooks.enabled()) cancel();
    },
    cancel,
    onPointerDown: (event: Pointer) => {
      if (!event.currentTarget.contains(event.target as Node)) return;
      lastInput = event.pointerType;
      if (event.pointerType !== 'touch') return;
      firstClick = false;
      if (!event.isPrimary || active) {
        cancel();
        return;
      }
      if (
        !hooks.enabled() ||
        !isMessageReplyTarget(event.target, event.currentTarget, true)
      )
        return;
      active = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        root: event.currentTarget,
        dragging: false,
      };
    },
    onPointerMove: (event: Pointer) => {
      if (!active || event.pointerId !== active.id) return;
      if (!hooks.enabled()) {
        cancel();
        return;
      }
      const dx = event.clientX - active.x,
        dy = event.clientY - active.y;
      if (!active.dragging) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
        if (dx >= 0 || -dx < Math.abs(dy) * 1.5) {
          cancel();
          return;
        }
        active.dragging = true;
        active.root.setAttribute('data-reply-dragging', '');
        active.root.setPointerCapture?.(active.id);
      }
      const distance = Math.max(0, -dx);
      active.root.style.setProperty(
        '--reply-shift',
        `${-Math.min(88, distance)}px`,
      );
      active.root.style.setProperty(
        '--reply-progress',
        String(Math.min(1, distance / THRESHOLD)),
      );
      active.root.toggleAttribute('data-reply-ready', distance >= THRESHOLD);
      suppressUntil = Date.now() + 500;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    },
    onPointerUp: (event: Pointer) => {
      if (!active || event.pointerId !== active.id) return;
      const distance = active.x - event.clientX;
      const reply =
        active.dragging &&
        distance >= THRESHOLD &&
        Math.abs(event.clientY - active.y) < distance * 0.8 &&
        hooks.enabled();
      if (active.dragging) {
        suppressUntil = Date.now() + 500;
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
      }
      reset();
      if (reply) hooks.reply();
    },
    onPointerCancel: cancel,
    onLostPointerCapture: (event: Pointer) => {
      // Touch initially captures the pressed child. Ignore its bubbled loss
      // when a horizontal swipe transfers capture to the message row.
      if (
        event.target === event.currentTarget &&
        event.pointerId === active?.id
      )
        cancel();
    },
    onClickCapture: (event: Click) => {
      if (!event.currentTarget.contains(event.target as Node)) return false;
      if (Date.now() < suppressUntil) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      if (event.detail === 1)
        firstClick =
          lastInput !== 'touch' &&
          hooks.enabled() &&
          event.button === 0 &&
          !modified(event) &&
          isMessageReplyTarget(event.target, event.currentTarget);
      return false;
    },
    onDoubleClick: (event: Click) => {
      const eligible = firstClick;
      firstClick = false;
      if (
        !eligible ||
        lastInput === 'touch' ||
        !hooks.enabled() ||
        event.button !== 0 ||
        modified(event) ||
        !isMessageReplyTarget(event.target, event.currentTarget)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const selection = event.currentTarget.ownerDocument?.getSelection();
      if (
        selection &&
        event.currentTarget.contains(selection.anchorNode) &&
        event.currentTarget.contains(selection.focusNode)
      )
        selection.removeAllRanges();
      hooks.reply();
    },
  };
}
