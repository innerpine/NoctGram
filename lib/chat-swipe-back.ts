import { animateSpring, createVelocityTracker, project } from './fluid-motion';

const EDGE = 20;
// Content that consumes horizontal drags of its own.
const CONTENT = '[role="slider"],input[type="range"],video,iframe';

/** Undecided before 10 px; then only a mostly rightward touch is a back swipe. */
export const backSwipeIntent = (dx: number, dy: number) =>
  Math.max(Math.abs(dx), Math.abs(dy)) < 10
    ? 'wait'
    : dx > Math.abs(dy) * 1.5
      ? 'take'
      : 'skip';

/** A clear flick decides by direction; otherwise where the chat would come to rest. */
export const commitsBack = (offset: number, velocity: number, width: number) =>
  Math.abs(velocity) > 300
    ? velocity > 0
    : offset + project(velocity) > width / 2;

type Stack = { panel: HTMLElement; list: HTMLElement };

/**
 * On phones the chat covers the hidden thread list. Back (the arrow, or a swipe
 * from the left edge in the installed app, where Safari does not own that edge)
 * slides the chat off over the list, then close() clears it the usual way.
 */
export function createChatSwipeBack(messenger: HTMLElement, close: () => void) {
  const host = messenger.ownerDocument.defaultView!;
  const tracker = createVelocityTracker();
  let drag: {
    id: number;
    x: number;
    y: number;
    base: number;
    target: EventTarget | null;
    taken: boolean;
    resume?: boolean;
  } | null = null;
  let candidate: Stack | null = null,
    moving: Stack | null = null,
    width = 1,
    offset = 0,
    exiting = false,
    spring: ReturnType<typeof animateSpring> | null = null;
  const reduced = () =>
    host.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stacked = (): Stack | null => {
    const panel = messenger.querySelector<HTMLElement>(':scope > .chat-panel'),
      list = messenger.querySelector<HTMLElement>(':scope > .threads-panel');
    return panel &&
      list &&
      messenger.classList.contains('peer-open') &&
      host.getComputedStyle(list).display === 'none'
      ? { panel, list }
      : null;
  };
  const paint = (x: number) => {
    offset = x;
    const progress = Math.min(1, Math.max(0, x / width));
    moving!.panel.style.translate = `${x}px 0`;
    moving!.list.style.translate = `${(progress - 1) * 30}% 0`;
    // Over the near-black card, fading the list in reads as a lifting dim.
    moving!.list.style.opacity = String(0.9 + progress * 0.1);
  };
  const begin = (stack: Stack) => {
    moving = stack;
    width = stack.panel.offsetWidth || 1;
    // The entrance animation would override the inline position.
    for (const animation of stack.panel.getAnimations?.() || [])
      animation.cancel();
    stack.panel.setAttribute('data-chat-swipe', '');
    paint(0);
  };
  const release = (stack: Stack, keepPanel: boolean) => {
    stack.list.style.removeProperty('translate');
    stack.list.style.removeProperty('opacity');
    if (!keepPanel) {
      stack.panel.style.removeProperty('translate');
      stack.panel.removeAttribute('data-chat-swipe');
    }
  };
  const finish = () => {
    const stack = moving!;
    spring = null;
    moving = null;
    offset = 0;
    // A chat replaced meanwhile (another route) is not the one to close.
    const commit = exiting && stack.panel.isConnected;
    exiting = false;
    if (!commit) return release(stack, false);
    // The list is already in its final place; the chat stays off-screen
    // until closing replaces it.
    release(stack, true);
    close();
    host.setTimeout(() => {
      if (stack.panel.isConnected) release(stack, false);
    }, 1000);
  };
  const settle = (commit: boolean, velocity = 0) => {
    exiting = commit;
    const to = commit ? width : 0;
    if (reduced()) {
      paint(to);
      return finish();
    }
    spring = animateSpring(offset, to, {
      damping: 1,
      response: 0.35,
      velocity,
      host,
      onUpdate: paint,
      onComplete: finish,
    });
  };
  const track = (event: PointerEvent, base: number, taken: boolean) => {
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      base,
      target: event.target,
      taken,
    };
    tracker.reset();
    tracker.add(event.clientX, event.clientY, event.timeStamp);
    host.addEventListener('pointermove', move, true);
    host.addEventListener('pointerup', up, true);
    host.addEventListener('pointercancel', cancel, true);
  };
  const end = () => {
    drag = null;
    candidate = null;
    host.removeEventListener('pointermove', move, true);
    host.removeEventListener('pointerup', up, true);
    host.removeEventListener('pointercancel', cancel, true);
  };
  const capture = (id: number) => {
    try {
      moving?.panel.setPointerCapture(id);
    } catch {
      // The pointer already ended; the window listeners still see its release.
    }
  };
  const down = (event: PointerEvent) => {
    if (drag) return;
    if (spring && moving) {
      if (
        event.isPrimary &&
        event.button === 0 &&
        moving.panel.contains(event.target as Node)
      ) {
        // Catch the moving chat under the finger and carry on from there.
        const live = spring.stop(),
          resume = exiting;
        spring = null;
        exiting = false;
        offset = live.value;
        event.stopPropagation();
        track(event, offset, true);
        drag!.resume = resume;
        capture(event.pointerId);
      } else if (exiting) {
        // Anything else cuts the exit short, so a tap lands on the list.
        spring.stop();
        paint(width);
        finish();
      }
      return;
    }
    const target = event.target;
    if (
      event.pointerType !== 'touch' ||
      !event.isPrimary ||
      !messenger.classList.contains('peer-open') ||
      !(target instanceof Element) ||
      !(messenger.closest('main') || messenger).contains(target) ||
      target.closest(CONTENT) ||
      !(
        host.matchMedia('(display-mode: standalone)').matches ||
        (host.navigator as { standalone?: boolean }).standalone === true
      )
    )
      return;
    const stack = stacked();
    if (!stack) return;
    const rect = stack.panel.getBoundingClientRect();
    if (
      event.clientX > rect.left + EDGE ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      return;
    candidate = stack;
    track(event, 0, false);
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    tracker.add(event.clientX, event.clientY, event.timeStamp);
    if (!drag.taken) {
      const intent = backSwipeIntent(
        event.clientX - drag.x,
        event.clientY - drag.y,
      );
      if (intent === 'wait') return;
      if (intent === 'skip' || moving || !candidate?.panel.isConnected)
        return end();
      drag.taken = true;
      // Follow from here: the first frame must not jump by the threshold.
      drag.x = event.clientX;
      tracker.reset();
      tracker.add(event.clientX, event.clientY, event.timeStamp);
      begin(candidate);
      capture(drag.id);
      // Content under the finger lets go, as when the browser takes a pan.
      drag.target?.dispatchEvent(
        new PointerEvent('pointercancel', {
          bubbles: true,
          pointerId: drag.id,
          pointerType: event.pointerType,
          isPrimary: true,
        }),
      );
      return;
    }
    if (!moving?.panel.isConnected) {
      if (moving) release(moving, false);
      moving = null;
      return end();
    }
    paint(Math.min(width, Math.max(0, drag.base + event.clientX - drag.x)));
  };
  const up = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const { taken, resume, x } = drag;
    tracker.add(event.clientX, event.clientY, event.timeStamp);
    end();
    if (!taken || !moving) return;
    const velocity = tracker.velocity().x;
    settle(
      // A tap on the moving chat only held it (a double tap on back, say).
      resume !== undefined && Math.abs(event.clientX - x) < 10
        ? resume
        : commitsBack(offset, velocity, width),
      velocity,
    );
  };
  const cancel = (event: PointerEvent) => {
    // Ignore the cancellation this controller sends to the content below.
    if (!event.isTrusted || !drag || event.pointerId !== drag.id) return;
    const { taken, resume } = drag;
    end();
    if (taken && moving) settle(resume ?? false);
  };
  host.addEventListener('pointerdown', down, true);
  return {
    /** The back arrow: the same exit, animated where the list is stacked below. */
    exit() {
      if (drag?.taken) return;
      if (spring) {
        exiting = true;
        spring.retarget(width);
        return;
      }
      const stack = stacked();
      if (!stack || reduced()) return close();
      begin(stack);
      settle(true);
    },
    dispose() {
      spring?.stop();
      spring = null;
      end();
      host.removeEventListener('pointerdown', down, true);
      if (moving) release(moving, false);
      moving = null;
      exiting = false;
    },
  };
}
