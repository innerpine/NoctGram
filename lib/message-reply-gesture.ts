import {
  animateSpring,
  createVelocityTracker,
  project,
  rubberband,
} from './fluid-motion';

const CONTROLS =
  'a,button,input,textarea,select,[contenteditable],[role="button"],[role="slider"],video,audio,iframe,[data-chat-menu-exempt],[data-chat-removing],[role="menu"]';
const TOUCH_CONTROLS = CONTROLS.replace('button,', '');
const THRESHOLD = 64;

/** 1:1 up to the reply threshold, then resisting. */
export const replyShift = (distance: number) =>
  distance <= THRESHOLD
    ? Math.max(0, distance)
    : THRESHOLD + rubberband(distance - THRESHOLD, 48);

/** A short flick still replies; flicking back toward the start cancels. */
export const repliesOnRelease = (distance: number, velocityX: number) =>
  velocityX <= 150 && distance + project(-velocityX) >= THRESHOLD;

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
  timeStamp: number;
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
    base: number;
  } | null = null;
  let lastInput = 'mouse',
    firstClick = false,
    suppressUntil = 0;
  // The shown offset outlives the touch while the message springs home.
  let offset = 0,
    spring: ReturnType<typeof animateSpring> | null = null;
  const tracker = createVelocityTracker();
  const clear = (root: HTMLElement) => {
    spring = null;
    offset = 0;
    root.removeAttribute('data-reply-dragging');
    root.style.removeProperty('--reply-shift');
  };
  const settle = (root: HTMLElement, velocity: number) => {
    spring?.stop();
    root.removeAttribute('data-reply-ready');
    // Dropping the progress fades the indicator out while the row returns.
    root.style.removeProperty('--reply-progress');
    if (
      !offset ||
      typeof window === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return clear(root);
    spring = animateSpring(offset, 0, {
      response: 0.3,
      velocity,
      onUpdate: (value) => {
        offset = Math.max(0, value);
        root.style.setProperty('--reply-shift', `${-offset}px`);
      },
      onComplete: () => clear(root),
    });
  };
  const reset = (velocity = 0) => {
    const previous = active;
    active = null;
    if (!previous) return;
    if (previous.root.hasPointerCapture?.(previous.id))
      previous.root.releasePointerCapture(previous.id);
    settle(previous.root, velocity);
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
      // Touching a returning message holds it where it is.
      spring?.stop();
      spring = null;
      active = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        root: event.currentTarget,
        dragging: false,
        base: offset,
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
        // Follow from here: the first frame must not jump by the threshold.
        active.x = event.clientX;
        tracker.reset();
        active.root.setAttribute('data-reply-dragging', '');
        active.root.setPointerCapture?.(active.id);
      }
      tracker.add(event.clientX, event.clientY, event.timeStamp);
      const distance = Math.max(0, active.base + active.x - event.clientX);
      offset = replyShift(distance);
      active.root.style.setProperty('--reply-shift', `${-offset}px`);
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
      const distance = Math.max(0, active.base + active.x - event.clientX);
      if (active.dragging)
        tracker.add(event.clientX, event.clientY, event.timeStamp);
      const velocity = active.dragging ? tracker.velocity().x : 0;
      const reply =
        active.dragging &&
        repliesOnRelease(distance, velocity) &&
        Math.abs(event.clientY - active.y) < distance * 0.8 &&
        hooks.enabled();
      if (active.dragging) {
        suppressUntil = Date.now() + 500;
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
      }
      reset(-velocity);
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
