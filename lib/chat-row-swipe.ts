import {
  animateSpring,
  createVelocityTracker,
  project,
  rubberband,
} from './fluid-motion';

/** Width of the action buttons a left swipe reveals. */
export const ROW_ACTIONS = 152;
const ACTIONS = '[data-row-actions]';

/** 1:1 over the actions, resisting past them; closed is a hard stop. */
export const rowOffset = (raw: number) =>
  raw >= 0
    ? 0
    : raw > -ROW_ACTIONS
      ? raw
      : -ROW_ACTIONS - rubberband(-ROW_ACTIONS - raw, ROW_ACTIONS);

/** A clear flick decides by direction; otherwise where the row would rest. */
export const rowOpens = (offset: number, velocity: number) =>
  Math.abs(velocity) > 300
    ? velocity < 0
    : offset + project(velocity) < -ROW_ACTIONS / 2;

type Pointer = {
  target: EventTarget | null;
  currentTarget: HTMLElement;
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
  timeStamp: number;
};
type Click = {
  target: EventTarget | null;
  preventDefault: () => void;
  stopPropagation: () => void;
};

// Only one row shows its actions at a time.
let openRow: { close: () => void } | null = null;

/** Per-row controller: touch only, vertical scrolling stays native (pan-y). */
export function createRowSwipe(reveal: () => void) {
  let root: HTMLElement | null = null,
    drag: {
      id: number;
      x: number;
      y: number;
      base: number;
      taken: boolean;
    } | null = null,
    offset = 0,
    spring: ReturnType<typeof animateSpring> | null = null,
    pressedOpen = false,
    suppressUntil = 0;
  const tracker = createVelocityTracker();
  const inActions = (target: EventTarget | null) =>
    target instanceof Element && !!target.closest(ACTIONS);
  const paint = (x: number) => {
    offset = x;
    root?.style.setProperty('--row-shift', `${x}px`);
  };
  const outside = (event: Event) => {
    if (!root?.contains(event.target as Node)) row.close();
  };
  const settle = (open: boolean, velocity = 0) => {
    spring?.stop();
    spring = null;
    if (open && openRow !== row) {
      openRow?.close();
      openRow = row;
      root?.ownerDocument.addEventListener('pointerdown', outside, true);
    } else if (!open && openRow === row) {
      openRow = null;
      root?.ownerDocument.removeEventListener('pointerdown', outside, true);
    }
    const to = open ? -ROW_ACTIONS : 0;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return paint(to);
    spring = animateSpring(offset, to, {
      response: 0.3,
      velocity,
      onUpdate: paint,
      onComplete: () => {
        spring = null;
      },
    });
  };
  const row = {
    close: () => {
      if (offset || spring) settle(false);
    },
    dispose: () => {
      spring?.stop();
      spring = null;
      if (openRow === row) {
        openRow = null;
        root?.ownerDocument.removeEventListener('pointerdown', outside, true);
      }
    },
    onPointerDown: (event: Pointer) => {
      pressedOpen = false;
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      root = event.currentTarget;
      pressedOpen = offset < 0;
      // Touching a moving row holds it where it is.
      spring?.stop();
      spring = null;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        base: offset,
        taken: false,
      };
    },
    onPointerMove: (event: Pointer) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x,
        dy = event.clientY - drag.y;
      if (!drag.taken) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        // Vertical movement scrolls; a closed row only opens to the left.
        if (Math.abs(dx) <= Math.abs(dy) * 1.5 || (dx > 0 && !drag.base)) {
          drag = null;
          row.close();
          return;
        }
        drag.taken = true;
        // Follow from here: the first frame must not jump by the threshold.
        drag.x = event.clientX;
        tracker.reset();
        reveal();
        event.currentTarget.setPointerCapture?.(drag.id);
      }
      tracker.add(event.clientX, event.clientY, event.timeStamp);
      paint(rowOffset(drag.base + event.clientX - drag.x));
      suppressUntil = Date.now() + 500;
    },
    onPointerUp: (event: Pointer) => {
      if (!drag || event.pointerId !== drag.id) return;
      const { taken } = drag;
      drag = null;
      if (!taken) {
        // A tap on an open row closes it; a tap on its actions leaves it open.
        if (pressedOpen) settle(inActions(event.target));
        return;
      }
      tracker.add(event.clientX, event.clientY, event.timeStamp);
      const velocity = tracker.velocity().x;
      settle(rowOpens(offset, velocity), velocity);
    },
    onPointerCancel: () => {
      if (!drag) return;
      drag = null;
      row.close();
    },
    onLostPointerCapture: (event: Pointer) => {
      if (!drag?.taken || event.target !== event.currentTarget) return;
      drag = null;
      settle(offset < -ROW_ACTIONS / 2);
    },
    onClickCapture: (event: Click) => {
      const swallow =
        !inActions(event.target) && (pressedOpen || Date.now() < suppressUntil);
      pressedOpen = false;
      if (!swallow) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
  return row;
}
